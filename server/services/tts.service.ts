import GlobalThis from '../global';
declare const global: GlobalThis;
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import settings from '../config/index';

// Configuration for Voice
export const voiceSettings = {
    length_scale: 0.8,
    noise_scale: 0.01,
    noise_w: 0.1,
    sentence_silence : 0.2, 
    speaker: 1,
    model: 'uk_UA-ukrainian_tts-medium',
};

// --- SINGLE TTS LANE ---
// Manages one persistent Piper process + one persistent sink (or web buffer)
class TTSLane {
    public id: string;
    public device: string | null;
    public volume: number;
    
    // Processes
    private piperProcess: ChildProcess | null = null;
    private sinkProcess: ChildProcess | null = null;
    private isPiperLaunching: boolean = false;
    private isSinkLaunching: boolean = false;
    private isDisposed: boolean = false;

    // State
    private queue: string[] = [];
    private isProcessing: boolean = false;
    private currentResolve: Function | null = null;
    private hasReceivedFirstChunk: boolean = false;
    
    private applyVoiceChanger: boolean;

    constructor(id: string, device: string | null, volume: number, applyVoiceChanger: boolean) {
        this.id = id;
        this.device = device;
        this.volume = volume;
        this.applyVoiceChanger = applyVoiceChanger;
        
        this.ensurePiper();
        setTimeout(() => this.ensureSink(), 500);
    }

    // --- PIPER ---
    private ensurePiper() {
        if (this.piperProcess || this.isPiperLaunching) return;
        this.isPiperLaunching = true;

        const piperDir = path.resolve(__dirname, '../tools/piper');
        const piperExe = path.join(piperDir, settings.IS_LINUX ? 'piper' : 'piper.exe');
        const modelPath = path.join(piperDir, `${voiceSettings.model}.onnx`);

        console.log(global.color('cyan', `[TTS ${this.id}]\t`), 'Launching persistent Piper...');

        try {
            const piperArgs = [
                '--model', modelPath,
                '--json-input',
                '--output-raw', 
                '--speaker', voiceSettings.speaker.toString(),
                '--length_scale', voiceSettings.length_scale.toString(),
                '--noise_scale', voiceSettings.noise_scale.toString(),
                '--noise_w', voiceSettings.noise_w.toString(),
            ];

            this.piperProcess = spawn(piperExe, piperArgs);
            this.isPiperLaunching = false;

            this.piperProcess.stdout?.on('data', (chunk: Buffer) => this.handleAudioChunk(chunk));
            
            this.piperProcess.stderr?.on('data', (data: Buffer) => {
                const log = data.toString();
                if (log.includes('Real-time factor') || log.includes('audio=')) {
                     this.finishCurrentUtterance();
                }
            });

            this.piperProcess.on('close', (code) => {
                if (this.isDisposed) return;
                console.log(global.color('red', `[TTS ${this.id}]\t`), `Piper exited (code ${code}). Restarting...`);
                this.piperProcess = null;
                setTimeout(() => this.ensurePiper(), 1000);
            });
        } catch (e) {
            console.error(`Failed to start Piper for ${this.id}:`, e);
            this.isPiperLaunching = false;
        }
    }

    // --- SINK ---
    private ensureSink() {
        if (this.sinkProcess || this.isSinkLaunching || !this.device) return;
        
        const soxExe = settings.IS_LINUX ? '/usr/bin/sox' : 'sox';
        if (settings.IS_LINUX && !fs.existsSync('/usr/bin/sox')) return;

        this.isSinkLaunching = true;
        console.log(global.color('cyan', `[TTS ${this.id}]\t`), `Starting Sink on ${this.device} (Vol: ${this.volume})`);

        const driver = settings.IS_LINUX ? 'alsa' : 'waveaudio';
        // Increased buffer size (--buffer 1024 or higher) to prevent cutoffs
        const inputArgs = ['--buffer', '2048', '-t', 'raw', '-r', '22050', '-b', '16', '-c', '1', '-e', 'signed-integer', '-'];
        const outputArgs = ['-q', '-r', '16000', '-t', driver, this.device]; // Fixed rate/order

        let effectsArgs: string[] = [];
        if (this.volume !== 1.0) effectsArgs.push('vol', this.volume.toFixed(2));
        
        // Apply Voice Changer ONLY if globally enabled AND enabled for this lane
        if (settings.USE_VOICE_CHANGER && this.applyVoiceChanger) {
             let params = settings.SOX_PARAMS || "";
             const soxSpeed = (1 / voiceSettings.length_scale).toFixed(4);
             if (params.includes('[s]')) params = params.replace('[s]', soxSpeed);
             effectsArgs.push(...params.split(' ').filter(x => x.length > 0));
        }

        try {
            // Debug command
            console.log(global.color('gray', `[TTS ${this.id}]\t`), `Debug: sox ${[...inputArgs, ...outputArgs, ...effectsArgs].join(' ')}`);
            
            const sink = spawn(soxExe, [...inputArgs, ...outputArgs, ...effectsArgs]);
            sink.on('close', (code) => {
                console.log(global.color('yellow', `[TTS ${this.id}]\t`), `Sink exited (code ${code}).`);
                this.sinkProcess = null;
            });
            sink.stderr?.on('data', (d) => {
                 // Ignore standard underflow warnings, but log valid errors
                 const msg = d.toString();
                 if (!msg.includes('under-run')) console.log(`[SoX Error ${this.id}]: ${msg}`);
            });
            sink.stdin?.on('error', () => {}); 

            this.sinkProcess = sink;
        } catch (e) {
            console.error(`Failed to spawn sink ${this.id}`, e);
        }
        this.isSinkLaunching = false;
    }

    // --- PROCESSING ---
    
    private handleAudioChunk(chunk: Buffer) {
        if (!this.hasReceivedFirstChunk) {
           this.hasReceivedFirstChunk = true;
           const time = `${new Date().toLocaleTimeString()}:${new Date().getMilliseconds()}`;
           console.log(global.color('magenta', `[TTS ${this.id}]\t`), `${time}\tGot first audio chunk. Start playing...`);
        }
        
        if (this.sinkProcess && this.sinkProcess.stdin && !this.sinkProcess.killed) {
            try { this.sinkProcess.stdin.write(chunk); } catch(e) {}
        }
    }

    private finishCurrentUtterance() {
        if (!this.currentResolve) return;
        
        this.currentResolve(Buffer.alloc(0));
        this.currentResolve = null;
        this.processQueue(); // Next
    }

    public speak(text: string) {
        if (!text || text.trim().length === 0) return;
        if(settings.SPIT_TEXT){
            // Разбиваем текст на предложения (по ., ! или ?) для ускорения первого звука
            const chunks = text.split(/(?<=[.?!])\s+/).filter(c => c.trim().length > 0);
            
            for (const chunk of chunks) {
                const time = `${new Date().toLocaleTimeString()}:${new Date().getMilliseconds()}`;
                console.log(global.color('cyan', `[TTS ${this.id}]\t`), `${time}\tQueueing text: "${chunk.substring(0,30)}..."`);
                this.queue.push(chunk.replace('.', '').trim());
            }
        } else {
            const time = `${new Date().toLocaleTimeString()}:${new Date().getMilliseconds()}`;
            console.log(global.color('cyan', `[TTS ${this.id}]\t`), `${time}\tQueueing text: "${text.substring(0,30)}..."`);
            this.queue.push(text);
        }
        this.processQueue();
    }

    private async processQueue() {
        if (this.isProcessing || this.queue.length === 0) return;
        this.isProcessing = true;
        
        const text = this.queue.shift();
        if (text) {
             await this.synthesize(text);
        }
        
        this.isProcessing = false;
        if (this.queue.length > 0) this.processQueue();
    }

    private async synthesize(text: string): Promise<any> {
        return new Promise((resolve) => {
            this.ensurePiper();
            this.ensureSink();

            if (!this.piperProcess) {
                resolve(null);
                return;
            }

            this.currentResolve = resolve;
            this.hasReceivedFirstChunk = false;
            
            try {
                this.piperProcess.stdin?.write(JSON.stringify({ text }) + '\n');
            } catch(e) {
                resolve(null);
            }
        });
    }

    public dispose() {
        this.isDisposed = true;
        if (this.piperProcess) this.piperProcess.kill();
        if (this.sinkProcess) this.sinkProcess.kill();
    }
}


// --- MAIN SERVICE ---

export class TTSService extends EventEmitter {
    private static instance: TTSService;
    
    private lanes: Record<string, TTSLane> = {};

    private constructor() {
        super();
        this.initLanes();
    }

    private initLanes() {
        // Create 2 independent lanes
        // SAY: Uses Voice Changer effects
        this.lanes['SAY'] = new TTSLane(
            'SAY', 
            settings.EXT_SPEAKER_NAME, 
            settings.EXT_VOLUME || 1.0, 
            true // Apply Effects
        );
        
        // WHISPER: Clean Voice (No Effects)
        this.lanes['WHISPER'] = new TTSLane(
            'WHISPER', 
            settings.PI_SPEAKER_NAME, 
            settings.PI_VOLUME || 1.0, 
            false // NO Effects
        );
    }

    public static getInstance(): TTSService {
        if (!TTSService.instance) {
            TTSService.instance = new TTSService();
        }
        return TTSService.instance;
    }

    public get isSaying(): boolean {
        // Technically this is lane specific now, but usually refers to "main" voice
        return false; // Not easily checking internal lane state from here without getters, assume irrelevant or fix later
    }

    public speak(text: string, type: string) {
        const target = (type === 'WHISPER') ? 'WHISPER' : 'SAY';
        if (this.lanes[target]) {
            this.lanes[target].speak(text);
        }
    }

    public dispose() {
        console.log(global.color('yellow', '[TTS]\t'), 'Disposing TTS Lanes...');
        Object.values(this.lanes).forEach(lane => lane.dispose());
    }

    public async genWav(text: string, filename: string): Promise<boolean> {
        return false; 
    }
}
