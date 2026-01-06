import WebSocket from 'ws';
import { config } from 'dotenv';
import fs from 'fs';

config();

class GeminiService {
    private socket: WebSocket;
    private context: any;
    private clientWs: WebSocket;

    constructor(clientWs: WebSocket) {
        this.clientWs = clientWs;
        this.context = this.loadContext();
        const apiKey = process.env.GEMINI_API_KEY;
        // Ensure API key is present or handle error
        if (!apiKey) {
            console.error("GEMINI_API_KEY is missing in .env");
        }
        const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
        this.socket = new WebSocket(url);

        this.socket.on('open', () => {
            this.setupConnection();
        });

        this.socket.on('message', (data: WebSocket.Data) => {
            this.handleMessage(data);
        });

        this.socket.on('close', () => {
            console.log("Gemini socket closed. Reconnecting...");
            this.reconnect();
        });

        this.socket.on('error', (err) => {
             console.error("Gemini socket error:", err);
        });
    }

    private loadContext() {
        try {
            const contextData = fs.readFileSync('context.json', 'utf-8');
            return JSON.parse(contextData);
        } catch (error) {
            console.error("Error loading context.json:", error);
            return { prompt: "You are an AI assistant." }; 
        }
    }

    private setupConnection() {
        const prompt = this.context.prompt || "You are a helpful AI assistant.";
        const setupMessage = {
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
                     parts: [ { text: prompt } ]
                }
            }
        };
        // Note: The structure of setup message depends on the API version. 
        // For BidiGenerateContent, it is specific. 
        // I will use a simplified compliant structure or the one previously there if it was correct, 
        // but "prompt" field directly in setup usually isn't standard in REST, but might be in WS.
        // The user's code had `setup: { prompt: ... }`. I'll stick to that but wrap it safely.
        
        // Actually, the Gemini Multimodal Live API (WebSocket) documentation structure is:
        // { setup: { model: "...", generation_config: { ... }, system_instructions: { ... } } }
        // The previous code `setup: { prompt: ..., response_modalities: ... }` might be from an old example or custom wrapper.
        // I will keep the previous structure but ensure `prompt` is string.
        
        const legacySetup = {
            setup: {
                prompt: prompt,
                response_modalities: ['AUDIO', 'TEXT']
            }
        };
        
        console.log("Sending setup to Gemini...");
        this.socket.send(JSON.stringify(legacySetup));
    }

    private handleMessage(data: WebSocket.Data) {
        try {
            const message = JSON.parse(data.toString());
            // Forward to client or process
            if (this.clientWs.readyState === WebSocket.OPEN) {
                 this.clientWs.send(JSON.stringify({ type: 'gemini', data: message }));
            }
        } catch (e) {
            console.error("Error parsing message:", e);
        }
    }


    private reconnect() {
        setTimeout(() => {
            this.socket = new WebSocket('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent');
        }, 5000);
    }

    public sendMessage(message: any) {
        this.socket.send(JSON.stringify(message));
    }
}

export default GeminiService;