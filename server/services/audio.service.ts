import { spawn } from 'child_process';
import EventEmitter from 'events';
import settings from '../config/index';

export class AudioService extends EventEmitter {
    private static instance: AudioService;
    private microphoneProcess: any;
    private isRunning: boolean = false;

    private constructor() {
        super();
    }

    public static getInstance(): AudioService {
        if (!AudioService.instance) {
            AudioService.instance = new AudioService();
        }
        return AudioService.instance;
    }

    public startAudioCapture() {
        if (this.isRunning) return;
        this.isRunning = true;

        console.log("Starting Audio Capture Service...");
        const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

        // 16kHz Mono Float32 (compatible with Web Audio API & Gemini)
        this.microphoneProcess = spawn(ffmpegPath, [
            '-f', 'dshow',
            '-audio_buffer_size', '10',
            '-i', settings.AUDIO_DEVICE,
            '-ar', '16000',
            '-ac', '1',
            '-f', 's16le', // PCM 16-bit for Gemini compatibility, we can convert to float for web if needed or web can handle int16? 
                           // Gemini expects PCM 16-bit usually. Web Audio API expects Float32 ideally, but we can iterate.
                           // User previous working code was f32le for web. Let's stick to s16le for standard compatibility and convert if needed.
                           // Actually, let's stick to what's easiest. Gemini likes PCM 16.
            'pipe:1'
        ]);

        this.microphoneProcess.stdout.on('data', (chunk: Buffer) => {
            // Broadcast raw PCM chunk
            this.emit('audio', chunk);
        });

        this.microphoneProcess.stderr.on('data', (data: any) => {
            // console.error(`Microphone stderr: ${data}`);
        });

        this.microphoneProcess.on('close', (code: number) => {
            console.log(`Microphone process exited with code ${code}`);
            this.isRunning = false;
        });
    }

    public stopMicrophone() {
        if (this.microphoneProcess) {
            this.microphoneProcess.kill('SIGKILL');
            this.isRunning = false;
        }
    }
}