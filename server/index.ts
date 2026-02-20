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
import { InputService } from './services/input.service';
import settings from "./config/index";
import { 
    getCommandConfig, 
    setGeminiInstance, 
    setAudioInstance,
    setVideoInstance,
    setTTSInstance,
    serviceStart, 
    saveBehaiviorsBuild, 
    buildInstruction, 
    behaiviorText 
} from "./config/commands";
import { execSync, spawn } from 'child_process';
import fs from 'fs';

// --- ZOMBIE CLEANUP ---
// Kill any lingering processes from previous crashed runs to free up audio devices
if (process.platform === 'linux') {
    try {
        console.log(global.color('yellow', '[System]\t'), 'Purging zombie processes...');
        // Silence errors (redirect stderr) so it doesn't clutter logs if nothing matches
        execSync('pkill -f sox || true');
        execSync('pkill -f piper || true');
        execSync('pkill -f ffmpeg || true');
        execSync('pkill -f rpicam-vid || true');
        execSync('pkill -f libcamera-vid || true');
    } catch (e) {
        // Ignore errors
    }
}

dotenv.config();

// Init Input Service (Bluetooth Remote)
InputService.getInstance();

const app = express();
const server = http.createServer(app);
const wss = new Server({ server });

app.use(cors());
app.use(express.json());

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

// Manual TTS Endpoints
app.get('/say', (req, res) => {
    const text = req.query.text as string;
    if (!text) return res.status(400).send("Missing text query param");
    
    ttsService.speak(text, 'SAY');
    res.send(`Saying: ${text}`);
});

app.get('/whisper', (req, res) => {
    const text = req.query.text as string;
    if (!text) return res.status(400).send("Missing text query param");
    
    ttsService.speak(text, 'WHISPER');
    res.send(`Whispering: ${text}`);
});

// Test SoX Endpoint
app.get('/test-sox', async (req, res) => {
    if (!fs.existsSync('test.wav')) {
        return res.status(404).send("test.wav not found in server root. Please place a wav file there.");
    }
    
    // We use a temporary output file for the test
    const outputPath = 'test_sox_out.wav';
    
    // Construct SoX command manually for the test
    const soxPath = settings.IS_LINUX ? '/usr/bin/sox' : path.resolve(__dirname, 'tools/sox/sox.exe');
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
// let isGeminiAudioActive = true; // Moved to AudioService

// --- SERVICE INITIALIZATION ---
const videoService = VideoService.getInstance();
setVideoInstance(videoService);

const audioService = AudioService.getInstance();
setAudioInstance(audioService);

const geminiService = GeminiService.getInstance();
setGeminiInstance(geminiService);

const ttsService = TTSService.getInstance();
setTTSInstance(ttsService);

// Auto-start Gemini for headless usage
/*console.log(global.color('green','[System]\t'), 'Auto-starting Gemini connection...');
isGeminiActive = true;
geminiService.connect();*/

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
    // Only send video if Audio is active (Push-to-Talk logic) to save tokens
    if (isGeminiActive && audioService.isGeminiAudioActive) {
        geminiService.sendVideoFrame(buffer);
    }
});

audioService.on('audio', (buffer) => {
    // Prevent self-hearing: Do not capture audio while TTS 'SAY' is active (outputting to speakers)
    // WHISPER uses headphones/internal routing so it might be fine, or we can block that too if needed.
    if (ttsService.isSaying) {
        return;
    }

    if (isGeminiActive && audioService.isGeminiAudioActive) {
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
        /*if (!settings.ENABLE_CLIENT_MIC_MONITORING) {
            ws.close();
            return;
        }*/

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
                    audioService.isGeminiAudioActive = !!msg.enabled;
                    console.log(global.color('blue', '[Control]\t'),`Gemini Audio: ${audioService.isGeminiAudioActive ? 'ON' : 'OFF'}`);
                }

                if (msg.type === 'gemini_chat') {
                    if (isGeminiActive) {
                        geminiService.sendTextMessage(msg.text);
                    } else {
                        // Optionally auto-enable or warn
                        ws.send(JSON.stringify({ type: 'log', text: 'Error: Enable Gemini first' }));
                    }
                }

                if (msg.type === 'keyboard_event') {
                    if (msg.data && msg.data.key && msg.data.action) {
                        InputService.getInstance().handleWebInput(msg.data.key, msg.data.action);
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

// --- GRACEFUL SHUTDOWN ---
const shutdown = () => {
    console.log('\n'+global.color('red', '[System]\t'), 'Shutting down...');
    
    // Stop Services
    try { InputService.getInstance().stop(); } catch(e){} 
    try { TTSService.getInstance().dispose(); } catch(e){}
    try { if (geminiService) geminiService.disconnect(); } catch(e){}
    try { if (videoService) videoService.stopVideoCapture(); } catch(e){}
    try { if (audioService) audioService.stopMicrophone(); } catch(e){} // Ensure mic is released

    // Close HTTP Server
    server.close(() => {
        console.log(global.color('green', '[System]\t'), 'HTTP server closed.');
    });
    
    // Kill external processes (safe cleanup)
    const { exec, spawnSync } = require('child_process');
    if (settings.IS_LINUX) {
        // Force kill everything related to our app
        exec('pkill -f "rpicam-vid"');
        exec('pkill -f "libcamera-vid"');
        exec('pkill -f "ffmpeg"'); 
        exec('pkill -f "sox"');
        exec('pkill -f "piper"');
        // Aggressively kill gpiomon too
        try { spawnSync('pkill', ['-9', '-f', 'gpiomon'], { stdio: 'ignore' }); } catch(e){}
    }
    

    setTimeout(() => {
        try {
            // Write directly to stderr to ensure visibility (file descriptor 2)
            fs.writeSync(2, global.color('red', '[System]\t') + ' Force exiting via SIGKILL...\n');
        } catch(e) {}
        
        // Instant suicide. No cleanup, no flush, no mercy.
        process.kill(process.pid, 'SIGKILL');
    }, 500); // 500ms timeout
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGUSR2', shutdown); // Handle nodemon restart signal

server.listen(PORT, () => {
    console.log(global.color('green','[Web]\t\t'), 'Server is running on', global.color('yellow', `http://localhost:${PORT}`));
});


serviceStart('begin');

// --- GPIO SWITCH CONTROL (Shell Exec Fallback) ---
// Since native Node libraries are failing with EINVAL on this kernel/OS version (Debian 13),
// we will use the system's 'gpiod' tools directly via child_process.

const GPIO_PIN = 17;
// On RPi 5/Bookworm, user pins are often on gpiochip4. On Pi 4, gpiochip0.
// We prioritize gpiochip0 as it is standard on most Pi 4 setups.
const CHIP_CANDIDATES = ['gpiochip0', 'gpiochip4']; 

function findGpioChip(pin: number): string | null {
    if (!settings.IS_LINUX) return null;
    for (const chip of CHIP_CANDIDATES) {
        try {
            // Check if we can read the line on this chip without error
            // gpioget v2 requires --chip flag
            execSync(`gpioget --chip ${chip} ${pin}`,{stdio: 'pipe'});
            return chip;
        } catch (e) { continue; }
    }
    return null;
}

try {
    if (settings.IS_LINUX) {
        const chip = findGpioChip(GPIO_PIN);
        
        if (chip) {
            console.log(global.color('green', '[GPIO]\t\t'), `Using ${chip} for GPIO ${GPIO_PIN}...`);
            
            // 1. Initial State Read with Bias
            try {
                // If switch is OPEN (OFF), pinning is floating -> need Pull-Up to see '1'
                // If switch is CLOSED (ON), it is grounded -> '0'
                // So we MUST use --bias=pull-up to ensure '1' when OFF.
                
                // ADDED --numeric to get just "0" or "1" output.
                const out = execSync(`gpioget --chip ${chip} --bias=pull-up --numeric ${GPIO_PIN}`).toString().trim();
                const initialActive = (out === '0'); // 0 means Grounded/ON
                
                if (initialActive) {
                    // Set flag immediately
                    isGeminiActive = true; 
                    
                    console.log(global.color('cyan', '[GPIO]\t\t'), "Switch initially ON -> Enabling Gemini");
                    
                    // Delay connection slightly to allow rest of server to settle
                    setTimeout(() => {
                        if(isGeminiActive) geminiService.connect();
                    }, 2000);
                } else {
                    console.log(global.color('yellow', '[GPIO]\t\t'), "Switch initially OFF -> Gemini Standby");
                    isGeminiActive = false;
                }
            } catch(e) { console.warn("GPIO Init Read Error", e); }

            // 2. Start Monitor Process (gpiomon)
            // Added -p 50ms debounce to filter out mechanical noise
            // Added detached:true to ensure we can kill it cleanly without signal propagation issues?
            // But we want it to die when parent dies usually. 
            // Let's stick to standard spawn but handle kill better.
            const monitor = spawn('gpiomon', [
                '--chip', chip, 
                '--bias=pull-up', 
                '--num-events=0', 
                '--debounce-period=50ms', // HARDWARE DEBOUNCE via driver
                '--format=%E', 
                String(GPIO_PIN)
            ]); // Removed unneeded options, rely on default piping for stdout

            monitor.unref(); // Don't let this child prevent Node from exiting naturally if event loop is empty
                             // (Though we have other active handles like server)
            
            // Software throttle to prevent rapid toggle spam
            let lastToggleTime = 0;
            const TOGGLE_COOLDOWN = 1000; // 1 second cooldown
            
            monitor.stdout.on('data', (data: any) => {
                const lines = data.toString().split('\n');
                lines.forEach((line: string) => {
                    const l = line.trim();
                    if (!l) return;
                    
                    const now = Date.now();
                    if (now - lastToggleTime < TOGGLE_COOLDOWN) {
                        console.log(global.color('yellow', '[GPIO]\t\t'), "Ignored rapid toggle (Debounce)");
                        return;
                    }

                    // falling -> Transition to LOW (0) -> Active
                    if (l.includes('falling')) {
                        if (!isGeminiActive) {
                            lastToggleTime = now;
                            console.log(global.color('cyan', '[GPIO]\t\t'),"Switch ON -> Enabling Gemini");
                            isGeminiActive = true;
                            geminiService.connect();
                            wss.clients.forEach(c => {
                                if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ type: 'gemini_control_sync', enabled: true }));
                            });
                        }
                    } 
                    // rising -> Transition to HIGH (1) -> Inactive
                    else if (l.includes('rising')) {
                        if (isGeminiActive) {
                            lastToggleTime = now;
                            console.log(global.color('yellow', '[GPIO]\t\t'),"Switch OFF -> Disabling Gemini");
                            isGeminiActive = false;
                            geminiService.disconnect();
                            wss.clients.forEach(c => {
                                if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ type: 'gemini_control_sync', enabled: false }));
                            });
                        }
                    }
                });
            });

            monitor.stderr.on('data', (d: any) => { /* ignore startup msgs */ });
            
            // Cleanup on exit
            const cleanup = () => { 
                try { 
                    // Use tree-kill logic if needed, but SIGKILL on the handle usually works
                    monitor.kill('SIGKILL'); 
                } catch(e) {} 
            };
            
            process.on('exit', cleanup);
            
            // Allow Node to exit even if this child is running (though we want to kill it)
            // But if we unref, we might not get events? 
            // Actually, keep it referenced but ensure we kill it.
            
            // CRITICAL: If the child process holds onto the TTY or something, it might block exit?
            // Let's ensure we don't restart it or anything.

        } else {
             console.log(global.color('red', '[GPIO]\t'), `Could not find valid GPIO chip for Pin ${GPIO_PIN}. Ensure gpiod is installed.`);
        }
    }
} catch (e: any) {
    if (settings.IS_LINUX) {
        console.warn(global.color('red', '[GPIO]\t'), `Setup failed entirely: ${e.message}`);
    }
}

//fuser -k 5000/tcp || lsof -ti:5000 | xargs -r kill -9
//pkill -f "ts-"