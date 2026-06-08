import GlobalThis from '../global';
declare const global: GlobalThis;
import WebSocket from 'ws';
import { config } from 'dotenv';
import fs from 'fs';
import { EventEmitter } from 'events';
import { OledService } from './oled.service';
import { ProtocolProcessor } from './processor';
import { getCommandConfig, serviceStart, serviceStop, buildInstruction } from '../config/commands';
import { VideoService } from './video.service';
import settings from '../config/index';

config();

import path from 'path';

export class GptService extends EventEmitter {
    private static instance: GptService;
    private socket: WebSocket | null = null;
    public isConnected: boolean = false;
    private responseBuffer: string = "";
    private scanInterval: NodeJS.Timeout | null = null;
    public usedTokens: number = 0;
    public restartStage: number = 0;
    public isResponding: boolean = false;

    private constructor() {
        super();
    }

    public static getInstance(): GptService {
        if (!GptService.instance) {
            GptService.instance = new GptService();
        }
        return GptService.instance;
    }

    public connect() {
        if (this.socket) return;

        const apiKey = process.env.OPEN_AI_API_KEY;
        if (!apiKey) {
            console.log(global.color('red', '[Control]\t'), "OPEN_AI_API_KEY is missing via .env");
            return;
        }

        const model = process.env.GPT_MODEL || "gpt-realtime-1.5";
        const url = `wss://api.openai.com/v1/realtime?model=${model}`;
        
        this.socket = new WebSocket(url, {
            headers: {
                "Authorization": "Bearer " + apiKey
            }
        });

        this.socket.on('open', () => {
            OledService.getInstance().AIStatus(true);
            console.log(global.color('green', "Connected to GPT Realtime"));
            this.isConnected = true;
            this.sendSetup();
            
            setTimeout(() => {
                serviceStart('start');
                serviceStart('contextUpdater');
                serviceStart('timeSync');
            }, 500);
        });

        this.socket.on('message', (data: WebSocket.Data) => {
            this.handleMessage(data);
        });

        this.socket.on('close', (code, reason) => {
            OledService.getInstance().AIStatus(false);
            if (code === 1000) {
                console.log(global.color('yellow', '[GPT]\t'), "Socket closed normally.");
            } else {
                console.log(global.color('red', '[GPT]\t'), `Socket closed: ${global.color('yellow', code)} - ${reason}`);
                setTimeout(() => this.reconnect(), 1000);
            }
            this.cleanup();
        });

        this.socket.on('error', (err) => {
            console.log(global.color('red', '[GPT]\t'), "Socket error:", err);
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
        this.isResponding = false;
        this.socket = null;
        this.responseBuffer = "";
        serviceStop('contextUpdater');
        serviceStop('timeSync');
    }

    public reconnect() {
        console.log(global.color('yellow', '[GPT]\t'), `Reconnecting to GPT...`);
        this.disconnect();
        setTimeout(() => this.connect(), 500);
    }

    private sendSetup() {
        if (!this.socket) return;
        const systemInstructionText = buildInstruction();
        
        const setupMsg = {
            type: "session.update",
            session: {
                type: "realtime",
                output_modalities: ["text"],
                instructions: systemInstructionText
            }
        };

        console.log(global.color('green', '[GPT]\t'), "Sending setup message", global.color('green', '[OK]'));
        this.socket.send(JSON.stringify(setupMsg));
    }

    public sendVideoFrame(c: Buffer) {
        if (!this.isConnected || !this.socket || this.restartStage) return;
        
        const detail = VideoService.getInstance().getGptDetail();
        const msg = {
            type: "conversation.item.create",
            item: {
                type: "message",
                role: "user",
                content: [{ 
                    type: "input_image",
                    detail,
                    image_url: `data:image/jpeg;base64,${c.toString('base64')}` 
                }]
            }
        };
        this.socket.send(JSON.stringify(msg));
    }

    public sendAudioChunk(c: Buffer, mimeType: string = "audio/pcm") {
        if (!this.isConnected || !this.socket || this.restartStage) return;
        const msg = {
            type: "input_audio_buffer.append",
            audio: c.toString('base64')
        };
        this.socket.send(JSON.stringify(msg));
    }

    public sendSilence() {
        const sampleRate = parseInt(process.env.MIC_SAMPLE_RATE || '24000');
        this.sendAudioChunk(Buffer.alloc(sampleRate * 2));
    }

    public sendTextMessage(text: string) {
        if (!this.isConnected || !this.socket) return;
        console.log(global.color('cyan', `[User]: ${text}`));

        const msg = {
            type: "conversation.item.create",
            item: {
                type: "message",
                role: "user",
                content: [{ type: "input_text", text: text }]
            }
        };
        this.socket.send(JSON.stringify(msg));
        if (!this.isResponding) {
            this.isResponding = true;
            this.socket.send(JSON.stringify({ type: "response.create" }));
        }
    }

    public sendPing() {
        if (!this.isConnected || !this.socket) return;
        const pingPath = path.join(settings.BASE_DIR, 'ping.wav');
        if (fs.existsSync(pingPath)) {
            const pingBuffer = fs.readFileSync(pingPath);
            this.sendAudioChunk(pingBuffer);
            this.socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        }
    }

    private handleMessage(data: WebSocket.Data) {
        try {
            const msg = JSON.parse(data.toString());
            
            if (msg.type === "response.created") {
                this.isResponding = true;
            }
            
            if (msg.type === "response.done" || msg.type === "response.cancelled" || msg.type === "error") {
                this.isResponding = false;
            }

            if (msg.type === "response.output_text.delta" || msg.type === "response.output_audio_transcript.delta") {
                this.responseBuffer += msg.delta;
            }
            
            if (msg.type === "response.done" || msg.type === "response.output_text.done" || msg.type === "response.output_audio_transcript.done") {
                const finalResponse = this.responseBuffer.trim();
                if (finalResponse.length > 0) {
                    this.processTextMarkers(finalResponse);
                }
                this.responseBuffer = "";
            }

            if (msg.type === "error") {
                console.log(global.color('red', '[GPT Error]\t'), msg.error.message);
            }

        } catch (e) {
            console.error("Error parsing GPT message:", e);
        }
    }

    private processTextMarkers(text: string) {
        const commands = ProtocolProcessor.parse(text);
        if (commands.length === 0) return;

        for (const cmd of commands) {
            const config = getCommandConfig(cmd.type);
            if (config.unknown) continue;
            
            const colorName = String(config.color) as any;
            const currentTime = new Date().toLocaleTimeString('uk-UA');
            console.log(currentTime, global.color(colorName, `[${cmd.type}]:\t`), cmd.content);

            if (config.work) config.work(cmd.content);
            this.emit('command', cmd);
        }
    }
}
