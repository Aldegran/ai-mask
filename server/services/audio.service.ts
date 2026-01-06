import { spawn } from 'child_process';
import { Readable } from 'stream';
import WebSocket from 'ws';
import config from '../config/index';

export class AudioService {
    private ws: WebSocket;
    private microphoneProcess: any;

    constructor(ws: WebSocket) {
        this.ws = ws;
        this.initializeMicrophone();
    }

    private initializeMicrophone() {
        this.microphoneProcess = spawn('ffmpeg', [
            '-f', 'dshow',
            '-i', 'audio="Microphone (Your Microphone Name)"', // Replace with your microphone name
            '-ar', '16000',
            '-ac', '1',
            '-f', 's16le',
            '-'
        ]);

        const audioStream = new Readable({
            read() {}
        });

        this.microphoneProcess.stdout.on('data', (data: any) => {
            const base64Audio = Buffer.from(data).toString('base64');
            this.ws.send(JSON.stringify({ audio: base64Audio }));
        });

        this.microphoneProcess.stderr.on('data', (data: any) => {
            console.error(`Microphone error: ${data}`);
        });

        this.microphoneProcess.on('close', (code: number) => {
            console.log(`Microphone process exited with code ${code}`);
        });
    }

    public stopMicrophone() {
        if (this.microphoneProcess) {
            this.microphoneProcess.kill();
        }
    }
}