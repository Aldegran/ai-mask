import { spawn } from 'child_process';
import { Writable } from 'stream';
import WebSocket from 'ws';
import config from '../config/index';

export class VideoService {
    private ws: WebSocket;
    private ffmpegProcess: any;

    constructor(ws: WebSocket) {
        this.ws = ws;
    }

    public startVideoCapture() {
        const videoSource = `video=YOUR_WEBCAM_NAME`; // Replace with your webcam name
        this.ffmpegProcess = spawn('ffmpeg', [
            '-f', 'dshow',
            '-i', videoSource,
            '-vf', 'scale=640:480',
            '-frames', '1',
            '-f', 'image2pipe',
            '-vcodec', 'mjpeg',
            '-pix_fmt', 'rgb24',
            '-r', '1', // 1 frame per second
            'pipe:1'
        ]);

        this.ffmpegProcess.stdout.on('data', (data: Buffer) => {
            const base64Image = data.toString('base64');
            this.ws.send(JSON.stringify({ type: 'video', data: base64Image }));
        });

        this.ffmpegProcess.stderr.on('data', (data: Buffer) => {
            console.error(`FFmpeg error: ${data}`);
        });

        this.ffmpegProcess.on('exit', (code: number) => {
            console.log(`FFmpeg process exited with code ${code}`);
        });
    }

    public stopVideoCapture() {
        if (this.ffmpegProcess) {
            this.ffmpegProcess.kill();
        }
    }
}