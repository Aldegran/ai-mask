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
import { OledService } from './services/oled.service';
import { GeminiService } from './services/gemini.service';
import { GptService } from './services/gpt.service';
import { AudioService } from './services/audio.service';
import { VideoService } from './services/video.service';
import { TTSService, voiceSettings } from './services/tts.service';
import { InputService } from './services/input.service';
import { DisplayService } from './services/display.service';
import settings from "./config/index";
import { 
    getCommandConfig, 
    setGeminiInstance, 
    setAudioInstance,
    setVideoInstance,
    setTTSInstance,
    setDisplayInstance,
    setOledInstance,
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
        execSync('pkill -f oled.py || true');
    } catch (e) {
        // Ignore errors
    }
}

const envPath = path.resolve(__dirname, __dirname.endsWith('dist') ? '../.env' : '.env');
dotenv.config({ path: envPath });

// --- MODULE CONTROL ---
// Toggle subsystems here
global.useModules = {
    audio: true,
    video: true,
    keyboard: true,
    ledMatrix: true,
    webServer: true,
    oled: true,
}

if (global.useModules.keyboard) {
    // Init Input Service (Bluetooth Remote)
    InputService.getInstance();
}

const app = express();
const server = http.createServer(app);
const wss = new Server({ server });

app.use(cors());
app.use(express.json());


if (global.useModules.webServer) {
    app.get('/', (req, res) => {
        res.sendFile(path.join(settings.BASE_DIR, 'index.html'));
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
            fs.writeFileSync(path.join(settings.BASE_DIR, 'instruction.txt'), text, 'utf-8');
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
        
        // Only run if service exists
        const tts = TTSService.getInstance(); // It's a singleton, safe to call but might be inert if not init properly outside? 
        // Actually we rely on the instance created below.
        if (global.useModules.audio && ttsService) {
             ttsService.speak(text, 'SAY');
             res.send(`Saying: ${text}`);
        } else {
             res.status(503).send("Audio module disabled");
        }
    });
    app.get('/emotion', (req, res) => {
        const emotion = req.query.emotion as string;
        if (displayService && emotion) displayService.setEmotion(emotion);
        res.send("Show: "+emotion);
    });

    app.get('/mask-light', (req, res) => {
        const light = req.query.light as string; // "1" or "0"
        if (displayService) {
            displayService.lamp(light === '1');
            if(oledService) oledService.lampStatus(light === '1');
            res.send(`Lamp ${light === '1' ? 'ON' : 'OFF'}`);
        } else {
             res.status(503).send("Display not active");
        }
    });

    app.get('/whisper', (req, res) => {
        const text = req.query.text as string;
        if (!text) return res.status(400).send("Missing text query param");
        
        if (global.useModules.audio && ttsService) {
            ttsService.speak(text, 'WHISPER');
            res.send(`Whispering: ${text}`);
        } else {
             res.status(503).send("Audio module disabled");
        }
    });

    // Test SoX Endpoint
    app.get('/test-sox', async (req, res) => {
        // ... (lines 173-207 omitted from old string)
    });

}

// --- BMP UPLOAD HANDLER ---
const multer = require('multer');
const upload = multer({ dest: path.join(settings.BASE_DIR, 'uploads/') });
const bmp = require('bmp-js');

app.post('/upload-bmp', upload.single('bmp'), (req: any, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");
    
    try {
        const filePath = req.file.path;
        
        if (displayService) {
            displayService.processBmp(filePath, 'emotion.hex');
        } else {
             // Fallback if display service not active (e.g. non-linux?)
             // Just delete temp file
             fs.unlinkSync(filePath);
             return res.status(503).send("Display Service not active");
        }
        
        // Cleanup temp file
        fs.unlinkSync(filePath);
        
        res.send("BMP Uploaded and Applied.");

    } catch (e:any) {
        console.error("BMP Error:", e);
        if(req.file) try{ fs.unlinkSync(req.file.path); }catch(e){}
        res.status(500).send(e.toString());
    }
});


// --- GLOBAL STATE ---
let isGeminiActive = false;

// --- SERVICE INITIALIZATION ---
let oledService: OledService | null = null;
if (global.useModules.oled) {
    try {
        oledService = OledService.getInstance();
        setOledInstance(oledService);
    } catch (e) {
        console.error("Failed to start OLED service:", e);
    }
}
let videoService: VideoService | null = null;
if (global.useModules.video) {
    videoService = VideoService.getInstance();
    setVideoInstance(videoService);
}

let audioService: AudioService | null = null;
if (global.useModules.audio) {
    audioService = AudioService.getInstance();
    setAudioInstance(audioService);
}

let geminiService: any;
if (process.env.LLM === 'gpt') {
    geminiService = GptService.getInstance();
} else {
    geminiService = GeminiService.getInstance();
}
setGeminiInstance(geminiService);

let ttsService: TTSService | null = null;
if (global.useModules.audio) {
    ttsService = TTSService.getInstance();
    setTTSInstance(ttsService);
}

let displayService: DisplayService | null = null;
if (global.useModules.ledMatrix) {
    displayService = DisplayService.getInstance();
    setDisplayInstance(displayService);
}


// Start Captures
if (global.useModules.video && videoService) {
    videoService.startVideoCapture();
}
if (global.useModules.audio && audioService) {
    audioService.startAudioCapture();
}

// Wire Gemini text response to Generic Handler
geminiService.on('command', (cmd: { type: string, content: string }) => {
    const config = getCommandConfig(cmd.type);
    
    // TTS Intercept
    if (global.useModules.audio && ttsService && config.shouldSpeak()!== false) {
        const textToSpeak = config.transformText ? config.transformText(cmd.content) : cmd.content;
        ttsService.speak(textToSpeak, cmd.type);
    }
});


// Validates that services are emitting data
let videoFrameCount = 0;
if (global.useModules.video && videoService) {
    videoService.on('frame', () => {
        videoFrameCount++;
        if (videoFrameCount % 100 === 0) console.log(global.color('green','[System]\t'),`Processed ${videoFrameCount} video frames`);
    });
}

// --- GLOBAL FORWARDING LOGIC ---
if (global.useModules.video && videoService) {
    videoService.on('frame', (buffer) => {
        // Only send video if Audio is active (Push-to-Talk logic) to save tokens
        if (isGeminiActive && audioService && audioService.isGeminiAudioActive) {
            geminiService.sendVideoFrame(buffer);
        }
    });
}

if (global.useModules.audio && audioService) {
    audioService.on('audio', (buffer) => {
        // Prevent self-hearing: Do not capture audio while TTS 'SAY' is active (outputting to speakers)
        if (ttsService && ttsService.isSaying) {
            return;
        }

        if (isGeminiActive && audioService && audioService.isGeminiAudioActive) {
            geminiService.sendAudioChunk(buffer);
        }
    });
}

// --- WEBSOCKET HANDLING ---
if (global.useModules.webServer) {
    wss.on('connection', (ws: WebSocket, req: any) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const pathname = url.pathname;

        // 1. VIDEO MONITOR
        if (pathname === '/monitor/video') {
           if (!global.useModules.video || !videoService) {
               ws.close();
               return;
           }
           console.log(global.color('blue','[Client]\t'), 'Video Monitor');
           
           const onFrame = (buffer: Buffer) => {
               if (ws.readyState === WebSocket.OPEN) {
                   ws.send(buffer);
               }
           };
           videoService.on('frame', onFrame);

           ws.on('close', () => {
               videoService?.off('frame', onFrame);
               console.log(global.color('yellow','[Client]\t'), 'Video Monitor disconnected');
           });
           return;
        }
        
        // 2. AUDIO MONITOR
        if (pathname === '/monitor/audio') {
            if (!global.useModules.audio || !audioService) {
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
                audioService?.off('audio', onAudio);
                console.log(global.color('yellow','[Client]\t'),'Audio Monitor disconnected');
            });
            return;
        }

        // 3. SYSTEM CONTROL (Gemini)
        if (pathname === '/control') {
            console.log(global.color('blue','[Client]\t'), 'Control');

            // Unified Command Forwarding
            const onCommand = (cmd: { type: string, content: string }) => {
                if (ws.readyState === WebSocket.OPEN) {
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
                        if (global.useModules.audio && audioService) {
                            audioService.isGeminiAudioActive = !!msg.enabled;
                            console.log(global.color('blue', '[Control]\t'),`Gemini Audio: ${audioService.isGeminiAudioActive ? 'ON' : 'OFF'}`);
                        }
                    }

                    if (msg.type === 'gemini_chat') {
                        if (isGeminiActive) {
                            geminiService.sendTextMessage(msg.text);
                        } else {
                            ws.send(JSON.stringify({ type: 'log', text: 'Error: Enable Gemini first' }));
                        }
                    }

                    if (msg.type === 'keyboard_event') {
                        if (msg.data && msg.data.key && msg.data.action) {
                            if (global.useModules.keyboard) {
                                InputService.getInstance().handleWebInput(msg.data.key, msg.data.action);
                            }
                        }
                    }
                } catch (err) {
                    console.error("Control msg error:", err);
                }
            });

            ws.on('close', () => {
                geminiService.off('command', onCommand);
                console.log(global.color('yellow', '[Control]\t'),"Control disconnected");
            });
            return;
        }
    });
} // End if(global.useModules.webServer)

const PORT = settings.PORT || 5000;

// --- GRACEFUL SHUTDOWN ---
const shutdown = () => {
    console.log('\n'+global.color('red', '[System]\t'), 'Shutting down...');
    
    // Stop Services
    try { if (global.useModules.keyboard) InputService.getInstance().stop(); } catch(e){} 
    try { if (global.useModules.audio && ttsService) ttsService.dispose(); } catch(e){}
    try { if (geminiService) geminiService.disconnect(); } catch(e){}
    try { if (global.useModules.video && videoService) videoService.stopVideoCapture(); } catch(e){}
    try { if (global.useModules.audio && audioService) audioService.stopMicrophone(); } catch(e){} // Ensure mic is released
    try { if (global.useModules.ledMatrix && displayService) displayService.stop(); } catch(e){} 
    try { if (global.useModules.oled && oledService) oledService.stop(); } catch(e){} 

    // Close HTTP Server
    if (global.useModules.webServer && server) {
        server.close(() => {
            console.log(global.color('green', '[System]\t'), 'HTTP server closed.');
        });
    }
    
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
        // Kill display script (sudo required usually)
        try { exec('sudo pkill -f display.py'); } catch(e){}
        try { exec('pkill -f oled.py'); } catch(e){}
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

if (global.useModules.webServer) {
    server.listen(PORT, () => {
        console.log(global.color('green','[Web]\t\t'), 'Server is running on', global.color('yellow', `http://localhost:${PORT}`));
    });
} else {
    console.log(global.color('yellow','[System]\t'), 'Webserver disabled via modules config.');
}


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
                    
                    console.log(global.color('cyan', '[GPIO]\t\t'), "Switch initially ON -> Enabling LLM");
                    
                    // Delay connection slightly to allow rest of server to settle
                    setTimeout(() => {
                        if(isGeminiActive) geminiService.connect();
                    }, 2000);
                } else {
                    console.log(global.color('yellow', '[GPIO]\t\t'), "Switch initially OFF -> LLM Standby");
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
                            console.log(global.color('cyan', '[GPIO]\t\t'),"Switch ON -> Enabling LLM");
                            isGeminiActive = true;
                            geminiService.connect();
                            if (global.useModules.webServer && wss) {
                                wss.clients.forEach(c => {
                                    if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ type: 'llm_control_sync', enabled: true }));
                                });
                            }
                        }
                    } 
                    // rising -> Transition to HIGH (1) -> Inactive
                    else if (l.includes('rising')) {
                        if (isGeminiActive) {
                            lastToggleTime = now;
                            console.log(global.color('yellow', '[GPIO]\t\t'),"Switch OFF -> Disabling Gemini");
                            isGeminiActive = false;
                            geminiService.disconnect();
                            if (global.useModules.webServer && wss) {
                                wss.clients.forEach(c => {
                                    if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ type: 'llm_control_sync', enabled: false }));
                                });
                            }
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