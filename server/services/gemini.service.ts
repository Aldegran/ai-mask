import GlobalThis from '../global';
declare const global: GlobalThis;
import WebSocket from 'ws';
import { config } from 'dotenv';
import fs from 'fs';
import { EventEmitter } from 'events';

config();

export class GeminiService extends EventEmitter {
    private static instance: GeminiService;
    private socket: WebSocket | null = null;
    private isConnected: boolean = false;
    private context: any;
    
    // Buffering & automated scanning
    private responseBuffer: string = "";
    private scanInterval: NodeJS.Timeout | null = null;

    private constructor() {
        super();
        this.context = this.loadContext();
    }

    public static getInstance(): GeminiService {
        if (!GeminiService.instance) {
            GeminiService.instance = new GeminiService();
        }
        return GeminiService.instance;
    }

    private loadContext() {
        try {
            if (fs.existsSync('context.json')) {
                const contextData = fs.readFileSync('context.json', 'utf-8');
                return JSON.parse(contextData);
            }
            return {};
        } catch (error) {
            console.error("Error loading context.json:", error);
            return {};
        }
    }

    public connect() {
        if (this.socket) {
            return;
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.log(global.color('red', '[Control]\t'),"GEMINI_API_KEY is missing via .env");
            return;
        }

        const host = "generativelanguage.googleapis.com";
        // Reverting to v1alpha for Gemini 2.0 Flash Exp (Stable WebSocket support)
        const uri = `wss://${host}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;

        this.socket = new WebSocket(uri);

        this.socket.on('open', () => {
            console.log(global.color('green', "Connected to Gemini"));
            this.isConnected = true;
            this.sendSetup();
            this.startScanningLoop();
            
            // Initial kickstart message
            setTimeout(() => {
                //this.sendTextMessage("Опиши свій настрій зараз");
                this.scanInterval = setInterval(() => {
                    this.sendPing();
                },5000);
            }, 500);
        });

        this.socket.on('message', (data: WebSocket.Data) => {
            this.handleMessage(data);
        });

        this.socket.on('close', (code, reason) => {
            console.log(`Gemini socket closed: ${code} - ${reason}`);
            this.cleanup();
        });

        this.socket.on('error', (err) => {
            console.error("Gemini socket error:", err);
            this.cleanup();
        });
    }

    public disconnect() {
        if (this.socket) {
            this.socket.close();
            this.cleanup();
        }
    }

    private cleanup() {
        this.isConnected = false;
        this.socket = null;
        this.responseBuffer = "";
        if (this.scanInterval) {
            clearInterval(this.scanInterval);
            this.scanInterval = null;
        }
    }

    private startScanningLoop() {
        if (this.scanInterval) clearInterval(this.scanInterval);
        // Removed polling loop. We will rely on passive streaming.
        // We can optionally send "heartbeats" just to keep connection alive if needed,
        // but for now let's trust the refined model to speak when it sees something.
    }

    private sendSetup() {
        if (!this.socket) return;
        
        let systemInstructionText = "";
        try {
            if (fs.existsSync('instruction.txt')) {
                systemInstructionText = fs.readFileSync('instruction.txt', 'utf-8').trim();
            } else {
                console.warn("instruction.txt not found, using default.");
                systemInstructionText = "You are a helpful AI.";
            }
        } catch (e) {
            console.error("Error reading instruction.txt", e);
        }

        const setupMsg = {
            setup: {
                model: "models/gemini-2.0-flash-exp",
                generation_config: {
                    response_modalities: ["TEXT"],
                    temperature: 0.6,
                },
                system_instruction: {
                    parts: [
                        { text: systemInstructionText }
                    ]
                }
            }
        };

        // console.log("Sending Setup:", JSON.stringify(setupMsg, null, 2));
        this.socket.send(JSON.stringify(setupMsg));
    }

        /*
        const systemInstruction = "You are a helpful assistant found in a futuristic mask.";
        
        const setupMsg = {
            setup: {
                model: "models/gemini-2.0-flash-exp",
                generationConfig: {
                    responseModalities: ["AUDIO", "TEXT"],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: {
                                voiceName: "Puck"
                            }
                        }
                    }
                },
                systemInstruction: {
                    parts: [
                        { text: systemInstruction } // TODO: Use this.context.prompt if valid
                    ]
                }
            }
        };

        this.socket.send(JSON.stringify(setupMsg));
        */
    //}

    public sendVideoFrame(c: Buffer) {
        if (!this.isConnected || !this.socket) return;
        
        const msg = {
            realtime_input: {
                media_chunks: [
                    {
                        mime_type: "image/jpeg",
                        data: c.toString('base64')
                    }
                ]
            }
        };
        this.socket.send(JSON.stringify(msg));
    }

    public sendAudioChunk(c: Buffer) {
        if (!this.isConnected || !this.socket) return;

        const msg = {
            realtime_input: {
                media_chunks: [
                    {
                        mime_type: "audio/pcm",
                        data: c.toString('base64')
                    }
                ]
            }
        };
        this.socket.send(JSON.stringify(msg));
    }

    public sendTextMessage(text: string) {
        if (!this.isConnected || !this.socket) return;

        console.log(global.color('cyan', `[User]: ${text}`));

        const msg = {
            client_content: {
                turns: [
                    {
                        role: "user",
                        parts: [
                            { text: text }
                        ]
                    }
                ],
                turn_complete: true
            }
        };

        this.socket.send(JSON.stringify(msg));
    }

    /*public sendHeartbeat() {
        if (!this.isConnected || !this.socket) return;
        const msg = { heartbeat: {} };
        this.socket.send(JSON.stringify(msg));
    }*/
    
    public sendPing() {
        if (!this.isConnected || !this.socket) return;
        
        // Load ping.wav to trigger VAD (Voice Activity Detection)
        // This is more reliable than white noise for grabbing attention.
        let pingBuffer: Buffer | null = null;
        try {
            // Using synchronous read is fine for a 10s interval
            if (fs.existsSync('ping.wav')) {
                 pingBuffer = fs.readFileSync('ping.wav');
            } else {
                 console.log(global.color('yellow', '[System Ping]'), "ping.wav not found, skipping audio trigger.");
            }
        } catch (e) {
            console.error("Error reading ping.wav", e);
        }

        if (pingBuffer) {
            const audioMsg = {
                realtime_input: {
                    media_chunks: [
                        {
                            mime_type: "audio/pcm",
                            data: pingBuffer.toString('base64')
                        }
                    ]
                }
            };
            this.socket.send(JSON.stringify(audioMsg));
        }

        /*const msg = {
            client_content: {
                turns: [
                    {
                        role: "user",
                        parts: [
                            { text: "[SYSTEM: SCAN_VIDEO]" }
                        ]
                    }
                ],
                turn_complete: true
            }
        };
        console.log(global.color('yellow', '[System Ping]'), "Sending audio heartbeat (ping.wav) + scan command");
        this.socket.send(JSON.stringify(msg));*/
    }

    private handleMessage(data: WebSocket.Data) {
        try {
            const str = data.toString();
            // Log everything for debug
            /*if (str.length > 500) {
                 console.log(global.color('gray', `[Gemini Raw]: ${str.substring(0, 200)} ... ${str.substring(str.length - 100)}`));
            } else {
                 console.log(global.color('gray', `[Gemini Raw]: ${str}`));
            }*/

            const msg = JSON.parse(str);

            // Handle "Turn"
            if (msg.serverContent && msg.serverContent.modelTurn && msg.serverContent.modelTurn.parts) {
                for (const part of msg.serverContent.modelTurn.parts) {
                    if (part.text) {
                        this.responseBuffer += part.text;
                    }
                }
            } 
            
            // Handle Turn Complete
            if (msg.serverContent && msg.serverContent.turnComplete) {
                const finalResponse = this.responseBuffer.trim();
                // Output raw thought process to console
                if (finalResponse.length > 0) {
                     console.log(global.color('cyan', '[Gemini Thought]:'), finalResponse);
                     this.processTextMarkers(finalResponse);
                }
                this.responseBuffer = "";
            }

        } catch (e) {
            console.error("Error parsing Gemini message:", e);
        }
    }

    private processTextMarkers(text: string) {
        // Regex for [SAY: ...]
        // Supports multiline if needed, but usually on one line. Using 'g' for multiple commands.
        const sayRegex = /\[SAY:\s*(.*?)\]/g;
        let match;
        while ((match = sayRegex.exec(text)) !== null) {
            const content = match[1].trim();
            if (content) {
                console.log(global.color('green', '[PARSED SAY]:'), content);
                this.emit('say', content);
            }
        }
        const whisperRegex = /\[WHISPER:\s*(.*?)\]/g;
        while ((match = whisperRegex.exec(text)) !== null) {
            const content = match[1].trim();
            if (content) {
                console.log(global.color('green', '[PARSED WHISPER]:'), content);
                this.emit('whisper', content);
            }
        }

        const thinkRegex = /\[THINK:\s*(.*?)\]/g;
        while ((match = thinkRegex.exec(text)) !== null) {
            const content = match[1].trim();
            if (content) {
                console.log(global.color('blue', '[PARSED THINK]:'), content);
                this.emit('think', content);
            }
        }

        // Regex for [EMOTION: ...]
        const emotionRegex = /\[EMOTION:\s*(.*?)\]/g;
        while ((match = emotionRegex.exec(text)) !== null) {
             const emotion = match[1].trim();
             if (emotion) {
                 console.log(global.color('magenta', '[PARSED EMOTION]:'), emotion);
                 this.emit('emotion', emotion);
             }
        }

        if(text.includes("[PONG]")) {
            console.log(global.color('yellow', '[PONG]'));
        }
    }
}

export default GeminiService;
