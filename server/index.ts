import GlobalThis from './global';
declare const global: GlobalThis;
import express from "express";
import http from 'http';
import WebSocket, { Server } from 'ws';
import cors from "cors";
import dotenv from "dotenv";
import path from 'path';
import color from './colorized';
global.color = color;
global.log = console.log;
import { GeminiService } from './services/gemini.service';
import { AudioService } from './services/audio.service';
import { VideoService } from './services/video.service';
import { TTSService, voiceSettings } from './services/tts.service';
import settings from "./config/index";
import { getCommandConfig, setGeminiInstance, serviceStart, saveBehaiviorsBuild, buildInstruction, behaiviorText } from "./config/commands";

dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new Server({ server });

app.use(cors());
app.use(express.json());

import fs from 'fs';

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- API ---
app.get('/instruction', (req, res) => {
    res.send(buildInstruction());
});
app.get('/behaivior', (req, res) => {
    res.send(behaiviorText);
});

app.get('/settings', (req, res) => {
    const { 
        FPS,
        CAMERA_FPS,
        CAMERA_WIDTH,
        CAMERA_HEIGHT,
        TTS_FOR,
        ENABLE_CLIENT_MIC_MONITORING,
    } = settings;

    res.json({ FPS,CAMERA_FPS,CAMERA_WIDTH,CAMERA_HEIGHT,TTS_FOR, ENABLE_CLIENT_MIC_MONITORING });
});

app.post('/instruction', (req, res) => {
    try {
        const text = req.body.text;
        if (typeof text !== 'string') {
             res.status(400).send("Invalid input");
             return;
        }
        fs.writeFileSync('instruction.txt', text, 'utf-8');
        console.log(global.color('green','[System]\t'), `Instruction updated via web interface`, global.color('green','[OK]'));
        res.send("Saved.");
    } catch(e:any) {
        res.status(500).send(e.toString());
    }
});
app.post('/behaivior', (req, res) => {
    try {
        const text = req.body.text;
        if (typeof text !== 'string') {
             res.status(400).send("Invalid input");
             return;
        }
        saveBehaiviorsBuild(text);
        console.log(global.color('green','[System]\t'), `Behaviour updated via web interface`, global.color('green','[OK]'));
        res.send("Saved.");
    } catch(e:any) {
        res.status(500).send(e.toString());
    }
});

// Test SoX Endpoint
app.get('/test-sox', async (req, res) => {
    if (!fs.existsSync('test.wav')) {
        return res.status(404).send("test.wav not found in server root. Please place a wav file there.");
    }
    
    // We use a temporary output file for the test
    const outputPath = 'test_sox_out.wav';
    
    // Construct SoX command manually for the test
    const soxPath = path.resolve(__dirname, 'tools/sox/sox.exe');
    if (!fs.existsSync(soxPath)) {
        return res.status(500).send("SoX not found at " + soxPath);
    }

    const { spawn } = require('child_process');
    
    // Allow overriding params via query: /test-sox?settings=pitch%20-300
    const soxParamsRaw = (req.query.settings as string) || settings.SOX_PARAMS;

    // SoX speed is inverse of Piper length_scale
    const soxSpeed = (1 / voiceSettings.length_scale).toFixed(4);

    const params = soxParamsRaw
        .replace('[s]', soxSpeed) 
        .split(' ')
        .filter(x => x.length > 0);
    const args = [
        'test.wav',
        outputPath,
        ...params
    ];

    try {
        const sox = spawn(soxPath, args);
        
        sox.stderr.on('data', (data:any) => console.log(`[SoX Test] ${data}`));
        
        sox.on('close', (code:number) => {
             if (code === 0) {
                 res.download(outputPath, (err) => {
                     // Cleanup
                     try{ fs.unlinkSync(outputPath); }catch(e){}
                 });
             } else {
                 res.status(500).send("SoX failed with code " + code);
             }
        });
    } catch (e:any) {
        res.status(500).send(e.toString());
    }
});


// --- GLOBAL STATE ---
let isGeminiActive = false;
let isGeminiAudioActive = true; 

// --- SERVICE INITIALIZATION ---
const videoService = VideoService.getInstance();
const audioService = AudioService.getInstance();
const geminiService = GeminiService.getInstance();
setGeminiInstance(geminiService);
const ttsService = TTSService.getInstance();

videoService.startVideoCapture();
audioService.startAudioCapture();

// Wire Gemini text response to Generic Handler
geminiService.on('command', (cmd: { type: string, content: string }) => {
    const config = getCommandConfig(cmd.type);
    // Note: config.work() is already called in gemini.service.ts before emitting 'command'
    // So we only handle cross-service wiring (like TTS) here.
    if (config.shouldSpeak()!== false) {
        const textToSpeak = config.transformText ? config.transformText(cmd.content) : cmd.content;
        ttsService.speak(textToSpeak, cmd.type);
    }
});


// Validates that services are emitting data
let videoFrameCount = 0;
videoService.on('frame', () => {
    videoFrameCount++;
    if (videoFrameCount % 100 === 0) console.log(global.color('green','[System]\t'),`Processed ${videoFrameCount} video frames`);
});

// --- GLOBAL FORWARDING LOGIC ---
// We wire the inputs to Gemini permanently here, but control flow via the flag.
videoService.on('frame', (buffer) => {
    if (isGeminiActive) {
        geminiService.sendVideoFrame(buffer);
    }
});

audioService.on('audio', (buffer) => {
    // Prevent self-hearing: Do not capture audio while TTS 'SAY' is active (outputting to speakers)
    // WHISPER uses headphones/internal routing so it might be fine, or we can block that too if needed.
    if (ttsService.isSaying) {
        return;
    }

    if (isGeminiActive && isGeminiAudioActive) {
        geminiService.sendAudioChunk(buffer);
    }
});

// --- WEBSOCKET HANDLING ---
wss.on('connection', (ws: WebSocket, req: any) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // 1. VIDEO MONITOR
    if (pathname === '/monitor/video') {
       console.log(global.color('blue','[Client]\t'), 'Video Monitor');
       
       const onFrame = (buffer: Buffer) => {
           if (ws.readyState === WebSocket.OPEN) {
               ws.send(buffer);
           }
       };
       videoService.on('frame', onFrame);

       ws.on('close', () => {
           videoService.off('frame', onFrame);
           console.log(global.color('yellow','[Client]\t'), 'Video Monitor disconnected');
       });
       return;
    }
    
    // 2. AUDIO MONITOR
    if (pathname === '/monitor/audio') {
        if (!settings.ENABLE_CLIENT_MIC_MONITORING) {
            ws.close();
            return;
        }

        console.log(global.color('blue','[Client]\t'), 'Audio Monitor');
        
    const onAudio = (buffer: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(buffer);
        }
    };
    audioService.on('audio', onAudio);

    ws.on('close', () => {
        audioService.off('audio', onAudio);
        console.log(global.color('yellow','[Client]\t'),'Audio Monitor disconnected');
    });
    return;
}

// 3. TTS MONITOR (Output Voice)
if (pathname === '/monitor/tts') {
    console.log(global.color('blue','[Client]\t'), 'TTS Monitor');

    const onTTS = (buffer: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(buffer);
        }
    };
    ttsService.on('audio', onTTS);

    ws.on('close', () => {
        ttsService.off('audio', onTTS);
        console.log(global.color('yellow','[Client]\t'),'TTS Monitor disconnected');
    });
    return;
}

    // 3. SYSTEM CONTROL (Gemini)
    if (pathname === '/control') {
        console.log(global.color('blue','[Client]\t'), 'Control');

        // Unified Command Forwarding
        const onCommand = (cmd: { type: string, content: string }) => {
            if (ws.readyState === WebSocket.OPEN) {
                // Forward as generic 'gemini_command'
                //const config = getCommandConfig(cmd.type);
                ws.send(JSON.stringify({ 
                    type: 'gemini_command', 
                    command: cmd.type, 
                    text: cmd.content 
                }));
            }
        };
        geminiService.on('command', onCommand);

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                
                if (msg.type === 'gemini_control') {
                    if (msg.enabled) {
                        console.log(global.color('green', '[Control]\t'),"Gemini ENABLED");
                        isGeminiActive = true;
                        geminiService.connect();
                        ws.send(JSON.stringify({ type: 'log', text: 'Gemini Session Started' }));
                    } else {
                        console.log(global.color('yellow', '[Control]\t'),"Gemini DISABLED");
                        isGeminiActive = false;
                        geminiService.disconnect();
                        ws.send(JSON.stringify({ type: 'log', text: 'Gemini Session Ended' }));
                    }
                }

                if (msg.type === 'audio_control') {
                    isGeminiAudioActive = !!msg.enabled;
                    console.log(global.color('blue', '[Control]\t'),`Gemini Audio: ${isGeminiAudioActive ? 'ON' : 'OFF'}`);
                }

                if (msg.type === 'gemini_chat') {
                    if (isGeminiActive) {
                        geminiService.sendTextMessage(msg.text);
                    } else {
                        // Optionally auto-enable or warn
                        ws.send(JSON.stringify({ type: 'log', text: 'Error: Enable Gemini first' }));
                    }
                }
            } catch (err) {
                console.error("Control msg error:", err);
            }
        });

        ws.on('close', () => {
            geminiService.off('command', onCommand);
            console.log(global.color('yellow', '[Control]\t'),"Control disconnected");
            // Optional: Auto-disable Gemini if control is lost?
            // isGeminiActive = false; 
        });
        return;
    }
});

const PORT = settings.PORT || 5000;
server.listen(PORT, () => {
    console.log(global.color('green','[Web]\t\t'), 'Server is running on', global.color('yellow', `http://localhost:${PORT}`));
});

serviceStart('begin');

//TTSService.getInstance().genWav("Тестуємо голос. Тестуємо звук", "test.wav");