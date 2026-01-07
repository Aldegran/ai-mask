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
            console.log(global.color('red', '[Control]'),"GEMINI_API_KEY is missing via .env");
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
        
        const systemInstruction = `
You are a Cyberpunk AI Implant named "Unit 01".
CONTEXT: You are connected to the user's brain and eyes.
MISSION:
1.  OBSERVE the video feed constantly.
2.  DETECT meaningful objects (weapons, tools, loot, hazards, people).
3.  REPORT: If you see something interesting closer to the camera, state its name clearly.
4.  IGNORE: Boring background (walls, empty rooms).
5.  INTERACT: If user speaks, reply in character (cynical, tactical, brief).

CRITICAL: Do not hallucinate. If you don't see anything clearly, stay silent.
`.trim();

        const setupMsg = {
            setup: {
                model: "models/gemini-2.0-flash-exp",
                // Reverted: Gemini 3 is REST-only for now. 2.0 Flash is the only Live API model.
                generationConfig: {
                    responseModalities: ["TEXT"],
                    temperature: 0.6, // Increased slightly for better chat in LARP
                },
                systemInstruction: {
                    parts: [
                        { text: systemInstruction }
                    ]
                }
            }
        };

        this.socket.send(JSON.stringify(setupMsg));

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
    }

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

    private handleMessage(data: WebSocket.Data) {
        try {
            const str = data.toString();
            const msg = JSON.parse(str);

            // 1. Accumulate Text chunks
            if (msg.serverContent && msg.serverContent.modelTurn && msg.serverContent.modelTurn.parts) {
                for (const part of msg.serverContent.modelTurn.parts) {
                    if (part.text) {
                        this.responseBuffer += part.text;
                    }
                }
            }
            
            // 2. Emit on Turn Complete and Clear Buffer
            if (msg.serverContent && msg.serverContent.turnComplete) {
                const finalResponse = this.responseBuffer.trim();
                
                // Keep '...' as requested by user to see heartbeat
                // Filter only empty/null
                if (finalResponse.length > 0) {
                    this.emit('text', finalResponse);
                    console.log(global.color('cyan', finalResponse));
                }
                
                this.responseBuffer = ""; // Reset for next turn
            }

        } catch (e) {
            console.error("Error parsing Gemini message:", e);
        }
    }
}

export default GeminiService;
