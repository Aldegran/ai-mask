import GlobalThis from '../global';
declare const global: GlobalThis;
import WebSocket from 'ws';
import { config } from 'dotenv';
import fs from 'fs';
import { EventEmitter } from 'events';

import { ProtocolProcessor } from './processor';
import { getCommandConfig, serviceStart, serviceStop, buildInstruction } from '../config/commands';
import settings from '../config/index';

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
    }

    public static getInstance(): GeminiService {
        if (!GeminiService.instance) {
            GeminiService.instance = new GeminiService();
        }
        return GeminiService.instance;
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
            
            setTimeout(() => {
                //serviceStart('begin');
                serviceStart('start');
                serviceStart('contextUpdater');
                serviceStart('timeSync');
            }, 500);
        });

        this.socket.on('message', (data: WebSocket.Data) => {
            this.handleMessage(data);
        });

        this.socket.on('close', (code, reason) => {
            console.log(global.color('red', '[Gemini]\t'),`Socket closed: ${global.color('yellow', code)} - ${reason}`);
            this.cleanup();
        });

        this.socket.on('error', (err) => {
            console.log(global.color('red', '[Gemini]\t'),"Socket error:", err);
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
        serviceStop('contextUpdater');
        serviceStop('timeSync');
        if (this.scanInterval) {
            clearInterval(this.scanInterval);
            this.scanInterval = null;
        }
    }

    private sendSetup() {
        if (!this.socket) return;
        
        const systemInstructionText = buildInstruction();
        
        if(systemInstructionText.length === 0) {
            console.log(global.color('red', '[Gemini]\t'),"System instruction is empty, aborting setup.");
            return;
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

        console.log(global.color('green', '[Gemini]\t'),"Sending setup message ", global.color('green', '[OK]'));
        this.socket.send(JSON.stringify(setupMsg));
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
                    //console.log(global.color('cyan', '[Gemini Thought]:'), finalResponse);
                    this.processTextMarkers(finalResponse);
                }
                this.responseBuffer = "";
            }

        } catch (e) {
            console.error("Error parsing Gemini message:", e);
        }
    }

    private processTextMarkers(text: string) {
        const commands = ProtocolProcessor.parse(text);
        
        if (commands.length === 0) {
            console.log(global.color('yellow', '[Gemini Raw]:'), text);
            // Optionally emit a 'THINK' command for raw text?
            // this.emit('command', { type: 'THINK', content: text });
            return;
        }

        for (const cmd of commands) {
            const config = getCommandConfig(cmd.type);
            if(config.unknown){
                console.log(global.color('yellow','[System]\t'),`Unknown command type from Gemini: "${cmd.type}"`);
                continue;
            }
            const color = config.color as any; // Cast to satisfy color function type if needed, or string
            const currentTime = new Date().toLocaleTimeString('uk-UA'); // HH:mm:ss
            console.log(currentTime, global.color(color, `[${cmd.type}]:\t`), cmd.content);

            if(config.work) {
                config.work(cmd.content);
            }

            // Emit single unified event
            this.emit('command', cmd);
        }
    }
}

export default GeminiService;
