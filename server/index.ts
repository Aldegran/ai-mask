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
import { TTSService } from './services/tts.service';
import settings from "./config/index";

dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new Server({ server });

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- GLOBAL STATE ---
let isGeminiActive = false;

// --- SERVICE INITIALIZATION ---
const videoService = VideoService.getInstance();
const audioService = AudioService.getInstance();
const geminiService = GeminiService.getInstance();
const ttsService = TTSService.getInstance();

console.log("Starting Capture Services...");
videoService.startVideoCapture();
audioService.startAudioCapture();

// Wire Gemini text response to TTS
geminiService.on('text', (text: string) => {
    console.log(`[System] Gemini said: "${text}". Queuing TTS...`);
    ttsService.speak(text);
});


// Validates that services are emitting data
let videoFrameCount = 0;
videoService.on('frame', () => {
    videoFrameCount++;
    if (videoFrameCount % 100 === 0) console.log(`[System] Processed ${videoFrameCount} video frames`);
});

// --- GLOBAL FORWARDING LOGIC ---
// We wire the inputs to Gemini permanently here, but control flow via the flag.
videoService.on('frame', (buffer) => {
    if (isGeminiActive) {
        geminiService.sendVideoFrame(buffer);
    }
});

audioService.on('audio', (buffer) => {
    if (isGeminiActive) {
        geminiService.sendAudioChunk(buffer);
    }
});

// --- WEBSOCKET HANDLING ---
wss.on('connection', (ws: WebSocket, req: any) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // 1. VIDEO MONITOR
    if (pathname === '/monitor/video') {
       console.log('Client connected: Video Monitor');
       
       const onFrame = (buffer: Buffer) => {
           if (ws.readyState === WebSocket.OPEN) {
               ws.send(buffer);
           }
       };
       videoService.on('frame', onFrame);

       ws.on('close', () => {
           videoService.off('frame', onFrame);
           console.log('Video Monitor disconnected');
       });
       return;
    }
    
    // 2. AUDIO MONITOR
    if (pathname === '/monitor/audio') {
        console.log('Client connected: Audio Monitor');
        
    const onAudio = (buffer: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(buffer);
        }
    };
    audioService.on('audio', onAudio);

    ws.on('close', () => {
        audioService.off('audio', onAudio);
        console.log('Audio Monitor disconnected');
    });
    return;
}

// 3. TTS MONITOR (Output Voice)
if (pathname === '/monitor/tts') {
    console.log('Client connected: TTS Monitor');

    const onTTS = (buffer: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(buffer);
        }
    };
    ttsService.on('audio', onTTS);

    ws.on('close', () => {
        ttsService.off('audio', onTTS);
        console.log('TTS Monitor disconnected');
    });
    return;
}

    // 3. SYSTEM CONTROL (Gemini)
    if (pathname === '/control') {
        console.log('Client connected: Control');

        // Forward Gemini text responses to this client
        const onText = (text: string) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'gemini_response', text }));
                //console.log(global.color('green', '[Gemini response]'), text);
            }
        };
        geminiService.on('text', onText);

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                
                if (msg.type === 'gemini_control') {
                    if (msg.enabled) {
                        console.log(global.color('green', '[Control]'),"Gemini ENABLED");
                        isGeminiActive = true;
                        geminiService.connect();
                        ws.send(JSON.stringify({ type: 'log', text: 'Gemini Session Started' }));
                    } else {
                        console.log(global.color('yellow', '[Control]'),"Gemini DISABLED");
                        isGeminiActive = false;
                        geminiService.disconnect();
                        ws.send(JSON.stringify({ type: 'log', text: 'Gemini Session Ended' }));
                    }
                }
            } catch (err) {
                console.error("Control msg error:", err);
            }
        });

        ws.on('close', () => {
            geminiService.off('text', onText);
            console.log(global.color('red', '[Control]'),"Control disconnected");
            // Optional: Auto-disable Gemini if control is lost?
            // isGeminiActive = false; 
        });
        return;
    }
});

const PORT = settings.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
