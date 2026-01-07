import { spawn } from 'child_process';
import EventEmitter from 'events';
import settings from '../config/index';

export class VideoService extends EventEmitter {
    private static instance: VideoService;
    private ffmpegProcess: any;
    private buffer: Buffer = Buffer.alloc(0);
    private isRunning: boolean = false;
    
    // Throttling logic
    private lastFrameTime: number = 0;
    private frameInterval: number = 1000 / settings.FPS;

    private constructor() {
        super();
    }

    public static getInstance(): VideoService {
        if (!VideoService.instance) {
            VideoService.instance = new VideoService();
        }
        return VideoService.instance;
    }

    public startVideoCapture() {
        if (this.isRunning) return;
        this.isRunning = true;

        const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
        console.log("Starting Video Capture Service...");

        // Capture at High FPS (hardware native) to avoid buffer lag
        const args = [
            '-f', 'dshow',
            '-rtbufsize', '100M',
            '-i', settings.VIDEO_DEVICE,
            '-r', settings.CAMERA_FPS.toString(),
            '-c:v', 'mjpeg',
            '-q:v', '10',
            '-f', 'image2pipe',
            'pipe:1'
        ];

        this.ffmpegProcess = spawn(ffmpegPath, args);

        this.ffmpegProcess.stdout.on('data', (chunk: Buffer) => {
            this.handleData(chunk);
        });

        this.ffmpegProcess.stderr.on('data', (data: Buffer) => {
           // console.error(`FFmpeg stderr: ${data}`); 
        });

        this.ffmpegProcess.on('exit', (code: number) => {
            console.log(`Video FFmpeg exited with code ${code}`);
            this.isRunning = false;
        });
    }

    private handleData(chunk: Buffer) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        
        let offset = 0;
        
        while (true) {
            const soi = this.buffer.indexOf(Buffer.from([0xFF, 0xD8]), offset);
            if (soi === -1) {
                // Safety cleanup
                if (this.buffer.length > 10 * 1024 * 1024) this.buffer = Buffer.alloc(0);
                break;
            }

            const eoi = this.buffer.indexOf(Buffer.from([0xFF, 0xD9]), soi);
            if (eoi === -1) {
                if(soi > 0) this.buffer = this.buffer.slice(soi);
                break;
            }

            const frameData = this.buffer.slice(soi, eoi + 2);
            
            // --- FPS Control Logic ---
            const now = Date.now();
            if (now - this.lastFrameTime >= this.frameInterval) {
                this.lastFrameTime = now;
                // Broadcast frame
                this.emit('frame', frameData);
            }
            // --------------------------

            offset = eoi + 2;
        }

        if (offset > 0) {
            this.buffer = this.buffer.slice(offset);
        }
    }

    public stopVideoCapture() {
        if (this.ffmpegProcess) {
            this.ffmpegProcess.kill('SIGKILL');
            this.isRunning = false;
        }
    }
}
