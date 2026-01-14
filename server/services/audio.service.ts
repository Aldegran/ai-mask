import GlobalThis from '../global';
declare const global: GlobalThis;
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

        //console.log("Starting Audio Capture Service...");
        const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

        // Helper to start process
        const startProcess = (deviceName: string) => {
            console.log(global.color('green','[Audio]\t\t'), 'Connecting to device:', global.color('yellow', deviceName));
            const args = [
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
                this.emit('audio', chunk);
            });

            this.microphoneProcess.stderr.on('data', (data: any) => {
                // console.error(`Microphone stderr: ${data}`);
            });

            this.microphoneProcess.on('close', (code: number) => {
                console.log(global.color('red','[Audio]\t\t'),'Microphone process exited with code', global.color('yellow', code));
                this.isRunning = false;
            });
        };

        if (/^\d+$/.test(settings.AUDIO_DEVICE)) {
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
            this.microphoneProcess.kill('SIGKILL');
            this.isRunning = false;
        }
    }
}