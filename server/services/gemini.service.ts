import GlobalThis from '../global';
declare const global: GlobalThis;
import WebSocket from 'ws';
import { config } from 'dotenv';
import fs from 'fs';
import { EventEmitter } from 'events';

/**
 * КОДЫ ЗАКРЫТИЯ WEBSOCKET GEMINI И ОБРАБОТКА ОШИБОК
 * ----------------------------------------------------
 * 1000 (Normal Closure / Нормальное закрытие):
 *   - Сессия завершена нормально.
 * 
 * 1001 (Going Away / Уход):
 *   - Конечная точка "уходит" (остановка сервера или навигация в браузере).
 * 
 * 1002 (Protocol Error / Ошибка протокола):
 *   - Конечная точка разорвала соединение из-за ошибки протокола.
 * 
 * 1003 (Unsupported Data / Неподдерживаемые данные):
 *   - Получены данные типа, который не может быть принят (например, бинарные вместо текста).
 * 
 * 1005 (No Status Received / Статус не получен):
 *   - Код статуса не был предоставлен, хотя он ожидался.
 * 
 * 1006 (Abnormal Closure / Аномальное закрытие):
 *   - "Сброс соединения" или "Потеря соединения". Сокет закрылся без отправки фрейма закрытия.
 *   - Часто случается при перебоях в сети.
 * 
 * 1007 (Invalid Frame Payload Data / Неверные данные полезной нагрузки):
 *   - Полученные данные не соответствуют типу сообщения (например, некорректный UTF-8).
 *   - Может возникнуть, если аудиофрагменты повреждены или заголовки неверны.
 * 
 * 1008 (Policy Violation / Нарушение политики или Ресурс не найден):
 *   - "Операция не реализована, не поддерживается или не включена".
 *   - Часто встречается при вызове функций (неверные ID, неподдерживаемые инструменты).
 *   - Также может указывать на неверный API-ключ или проблемы с доступом.
 * 
 * 1009 (Message Too Big / Сообщение слишком большое):
 *   - Сообщение слишком велико для обработки сервером.
 * 
 * 1011 (Internal Server Error / Внутренняя ошибка сервера):
 *   - "The service is currently unavailable" -> Перегрузка или сбой на стороне сервера.
 *   - "Failed to run inference for model..." -> Сбой модели ИИ (например, ошибка аудио токенизатора).
 *   - "Deadline expired before operation could complete" -> Контекст слишком велик или тайм-аут сессии.
 *   - Самая частая ошибка при длительных сессиях с потоковым аудио/видео.
 * 
 * 1015 (TLS Handshake / Рукопожатие TLS):
 *   - Сбой рукопожатия TLS (например, проверка сертификата).
 */

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
    public usedTokens: number = 0;
    public restartStage: number = 0;

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
            this.usedTokens = 0;
            this.restartStage = 0;
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
            if(code === 1000) {
                    console.log(global.color('yellow', '[Gemini]\t'),"Socket closed normally.");
            } else {
                console.log(global.color('red', '[Gemini]\t'),`Socket closed: ${global.color('yellow', code)} - ${reason}`);
                
                // Auto-reconnect for specific error codes
                // 1001: Server going away (restart)
                // 1006: Abnormal closure (network drop)
                // 1009: Message too big (context reset required)
                // 1011: Internal server error (overload)
                // 1015: TLS Handshake (network glitch)
                const restartableCodes = [1001, 1006, 1009, 1011, 1015];
                if (restartableCodes.includes(code)) {
                     console.log(global.color('yellow', '[Gemini]\t'), `Auto-reconnect in 3s due to error ${code}...`);
                     setTimeout(() => {
                         this.reconnect();
                     }, 1000);
                }
            }
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

    public reconnect() {
        console.log(global.color('yellow', '[Gemini]\t'),`Reconnecting to Gemini...`);
        if (this.socket) {
            this.disconnect();
            setTimeout(()=>{
                this.connect();
            },500);
        } else {
            this.connect();
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
                model: "models/gemini-2.0-flash-exp-image-generation",
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
        if (!this.isConnected || !this.socket || this.restartStage) return;
        
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

    public sendAudioChunk(c: Buffer, mimeType: string = "audio/pcm") {
        if (!this.isConnected || !this.socket || this.restartStage) return;

        const msg = {
            realtime_input: {
                media_chunks: [
                    {
                        mime_type: mimeType,
                        data: c.toString('base64')
                    }
                ]
            }
        };
        this.socket.send(JSON.stringify(msg));
    }

    public sendSilence() {
        this.sendAudioChunk(Buffer.alloc(16000));
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
           //console.log(global.color('gray', `[Gemini Raw]: ${str}`));
            const msg = JSON.parse(str);
            if (!msg.usageMetadata) { // Log significant non-usage messages (like audio triggers or setup)
                 // console.log(global.color('gray', '[Gemini Msg]\t'), JSON.stringify(msg).substring(0, 200));
            }

            if(msg.usageMetadata) {
                if(msg.usageMetadata?.totalTokenCount){
                    this.usedTokens = msg.usageMetadata?.totalTokenCount;
                    const tokensLeft = settings.MAX_TOKENS - this.usedTokens;
                    console.log(global.color('cyan', `[Tokens]:\t`), `Left ${(100-(tokensLeft*100/settings.MAX_TOKENS)).toFixed(1)}% ${tokensLeft}`);
                    if(this.usedTokens > settings.MAX_TOKENS && this.restartStage === 0){
                        console.log(global.color('yellow', '[Gemini]\t'),`Token limit reached, ${this.usedTokens}. Prepare reconnect.`);
                        this.restartStage = 1;
                        serviceStop('contextUpdater');
                        serviceStop('timeSync');
                        serviceStart('contextFast');
                        // Watchdog & Listener configuration
                        let waitTime: NodeJS.Timeout | null = null;

                        // 1. Start listening for context save completion (Stage 2)
                        waitTime = setInterval(() => {
                            if (this.restartStage === 2) {
                                this.restartStage = 3;
                                if (waitTime) clearInterval(waitTime);
                                setTimeout(() => {
                                    this.reconnect();
                                }, 1000);
                            }
                            // Safety: stop if reset happened externally
                            if (this.restartStage === 0 && waitTime) {
                                clearInterval(waitTime);
                            }
                        }, 300);

                        // 2. Safety Timeout (5s) - if context saving hangs, force reconnect
                        setTimeout(() => {
                            if (this.restartStage === 1) {
                                console.log(global.color('red', '[Gemini]\t'), "Context save timeout. Forcing reconnect.");
                                if (waitTime) clearInterval(waitTime);
                                this.reconnect();
                            }
                        }, 5000);
                    };
                }
            }

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
