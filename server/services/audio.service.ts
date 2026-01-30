import GlobalThis from '../global';
declare const global: GlobalThis;
import { spawn } from 'child_process';
import EventEmitter from 'events';
import settings from '../config/index';
import path from 'path';
import { voiceSettings } from './tts.service';

export class AudioService extends EventEmitter {
    private static instance: AudioService;
    private microphoneProcess: any;
    private isRunning: boolean = false;
    public isGeminiAudioActive: boolean = false;
    
    private soxProcess: any = null;
    public isVoiceChangerActive: boolean = false;

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

        //console.log("Starting Audio Capture Service...");
        const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

        // Helper to start process
        const startProcess = (deviceName: string) => {
            console.log(global.color('green','[Audio]\t\t'), 'Connecting to device:', global.color('yellow', deviceName));
            
            const args = settings.IS_LINUX ? [
                '-f', 'alsa',
                '-i', deviceName, 
                '-ar', '16000',
                '-ac', '1',
                '-f', 's16le',
                '-filter:a', 'volume=5.0', // Boost volume 5x
                'pipe:1'
            ] : [
                '-f', 'dshow',
                '-audio_buffer_size', '10',
                '-i', `audio=${deviceName}`,
                '-ar', '16000',
                '-ac', '1',
                '-f', 's16le',
                'pipe:1'
            ];

            this.microphoneProcess = spawn(ffmpegPath, args);

            this.microphoneProcess.stdout.on('data', (chunk: Buffer) => {
                if (this.isVoiceChangerActive && this.soxProcess) {
                     try { this.soxProcess.stdin.write(chunk); }
                     catch(e) { this.emit('audio', chunk); }
                } else {
                    this.emit('audio', chunk);
                }
            });

            this.microphoneProcess.stderr.on('data', (data: any) => {
                // console.error(`Microphone stderr: ${data}`);
            });

            this.microphoneProcess.on('close', (code: number) => {
                console.log(global.color('red','[Audio]\t\t'),'Microphone process exited with code', global.color('yellow', code));
                this.isRunning = false;
            });
        };

        if (!settings.IS_LINUX && /^\d+$/.test(settings.AUDIO_DEVICE)) {
           // Resolve index to name
           const listProc = spawn(ffmpegPath, ['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy']);
           let stderr = '';
           
           listProc.stderr.on('data', (data) => {
               stderr += data.toString();
           });

           listProc.on('close', () => {
               const lines = stderr.split('\n');
               const audioDevices: string[] = [];
               const regex = /"([^"]+)"/;
               
               lines.forEach(line => {
                   if (line.includes('(audio)') && regex.test(line)) {
                       const match = line.match(regex);
                       if (match) audioDevices.push(match[1]);
                   }
               });

               const index = parseInt(settings.AUDIO_DEVICE);
               if (audioDevices[index]) {
                   startProcess(audioDevices[index]);
               } else {
                   console.error(`[Audio] Device index ${index} out of range. Found ${audioDevices.length} audio devices.`);
                   this.isRunning = false;
               }
           });
        } else {
            // Use name directly
            startProcess(settings.AUDIO_DEVICE);
        }
    }

    public stopMicrophone() {
        if (this.microphoneProcess) {
            try { this.microphoneProcess.kill('SIGKILL'); } catch(e){}
            this.isRunning = false;
        }
    }

    public enableVoiceChanger(enable: boolean) {
        if (enable && settings.USE_VOICE_CHANGER) {
             if (this.isVoiceChangerActive) return;
             console.log(global.color('blue', '[Audio]\t\t'), "Voice Changer: ON");
             this.startSoxProcess();
             this.isVoiceChangerActive = true;
        } else {
             if (!this.isVoiceChangerActive) return;
             console.log(global.color('blue', '[Audio]\t\t'), "Voice Changer: OFF");
             this.isVoiceChangerActive = false;
             if (this.soxProcess) {
                 try { this.soxProcess.kill(); } catch(e){}
                 this.soxProcess = null;
             }
        }
    }

    private startSoxProcess() {
        const soxExe = settings.IS_LINUX ? 'sox' : path.resolve(__dirname, '../tools/sox/sox.exe');
        const mode = process.env.AUDIO_OUTPUT_MODE || 'default';
        const device = process.env.PI_SPEAKER_NAME || 'default';
        const driver = settings.IS_LINUX ? 'alsa' : 'waveaudio';

        // SoX Speed = 1 / Piper Length Scale
        const soxSpeed = (1 / voiceSettings.length_scale).toFixed(4);
        
        const effectArgs = settings.SOX_ECHO_PARAMS
            .split(' ')
            .filter(x => x.length > 0);

        // FFmpeg output is 16000Hz s16le mono
        // Added --buffer to reduce glitching
        const rawFormatArgs = ['--buffer', '2048', '-t', 'raw', '-r', '16000', '-b', '16', '-c', '1', '-e', 'signed-integer'];
        
        try {
            // If mode is NOT web, we output directly to the speakers (local monitor/mask mode)
            // If mode IS web, we output to stdout to be emitted to Gemini/Browser
            const outputArgs = (mode === 'web') 
                ? ['--buffer', '2048', '-t', 'raw', '-r', '16000', '-b', '16', '-c', '1', '-e', 'signed-integer'] 
                : ['-t', driver, device];

            this.soxProcess = spawn(soxExe, [
                ...rawFormatArgs, '-', 
                ...outputArgs,
                ...effectArgs
            ]);

            if (mode === 'web') {
                this.soxProcess.stdout.on('data', (chunk: Buffer) => {
                     this.emit('audio', chunk); // Emit processed audio to Gemini/Web
                });
            }
            
            this.soxProcess.stderr.on('data', (d:any) => {
                console.log(global.color('red','[SoX Mic]\t'), "Error: "+d.toString());
            });
            
            this.soxProcess.on('close', (code: number) => {
                 if( code !== null ) {
                    console.log(global.color('red','[SoX Mic]\t'), "Process exited with code", code);
                 }
                 this.isVoiceChangerActive = false;
                 this.soxProcess = null;
            });
            
            this.soxProcess.on('error', (err:any) => {
                console.error("SoX Mic Error", err);
                this.isVoiceChangerActive = false;
            });
        } catch (e) {
             console.log(global.color('red','[SoX Mic]\t'), "Failed to start SoX for Mic", e);
        }
    }
}