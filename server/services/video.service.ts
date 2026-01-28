import GlobalThis from '../global';
declare const global: GlobalThis;
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
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

    private showListDevices(listProc: ChildProcessWithoutNullStreams) {
        let c = 0;
        listProc.stderr.on('data', (data) => {
            if(data.toString().indexOf("(video)")>0) {
                console.log('\t'+c,global.color('yellow', (`${data}`).split('\n')[0].split(']')[1]));
                c++;
            }
        });
        let b = 0;
        listProc.stderr.on('data', (data) => {
            if(data.toString().indexOf("(audio)")>0) {
                console.log('\t'+b,global.color('blue', (`${data}`).split('\n')[0].split(']')[1]));
                b++;
            }
        });
    }

    public startVideoCapture() {
        const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
        
        if (this.isRunning) return;
        this.isRunning = true;
        //console.log("Starting Video Capture Service...");

        // Helper to start the actual capture process
        const startProcess = (deviceName: string) => {
            console.log(global.color('green','[Video]\t\t'), 'Connecting to device:', global.color('yellow', deviceName));
            
            if (settings.IS_LINUX) {
                // Raspberry Pi Camera using rpicam-vid (modern libcamera stack)
                const args = [
                    '-t', '0',
                    '--width', settings.CAMERA_WIDTH.toString(),
                    '--height', settings.CAMERA_HEIGHT.toString(),
                    '--framerate', settings.CAMERA_FPS.toString(),
                    '--codec', 'mjpeg',
                    '-n',
                    '-o', '-'
                ];
                
                this.ffmpegProcess = spawn('rpicam-vid', args);
            } else {
                const args = [
                    '-f', 'dshow',
                    '-video_size', `${settings.CAMERA_WIDTH}x${settings.CAMERA_HEIGHT}`,
                    '-rtbufsize', '100M',
                    '-i', `video=${deviceName}`,
                    '-r', settings.CAMERA_FPS.toString(),
                    '-c:v', 'mjpeg',
                    '-q:v', '10',
                    '-f', 'image2pipe',
                    'pipe:1'
                ];
                this.ffmpegProcess = spawn(ffmpegPath, args);
            }

            this.ffmpegProcess.stdout.on('data', (chunk: Buffer) => {
                this.handleData(chunk);
            });

            this.ffmpegProcess.stderr.on('data', (data: Buffer) => {
                 // console.error(`FFmpeg stderr: ${data}`); 
            });

            this.ffmpegProcess.on('exit', (code: number) => {
                console.log(global.color('red','[Video]\t\t'),'Video FFmpeg exited with code', global.color('yellow', code));
                this.isRunning = false;
            });
        };

        // If numeric index is provided, resolve it to a name first (Windows Only)
        if (!settings.IS_LINUX && /^\d+$/.test(settings.VIDEO_DEVICE)) {
            const listProc = spawn(ffmpegPath, ['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy']);
            let stderr = '';

            //this.showListDevices(listProc);

            listProc.on('close', () => {
                const lines = stderr.split('\n');
                const videoDevices: string[] = [];
                const regex = /"([^"]+)"/;
                
                lines.forEach(line => {
                    if (line.includes('(video)') && regex.test(line)) {
                        const match = line.match(regex);
                        if (match) videoDevices.push(match[1]);
                    }
                });

                const index = parseInt(settings.VIDEO_DEVICE);
                if (videoDevices[index]) {
                    startProcess(videoDevices[index]);
                } else {
                    console.error(`[Video] Device index ${index} out of range. Found ${videoDevices.length} video devices.`);
                    this.isRunning = false;
                }
            });
        } else {
             // Direct name usage
             // Still run list for logging purposes (Windows Only)
             if (!settings.IS_LINUX) {
                 const listProc = spawn(ffmpegPath, ['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy']);
             }
             //this.showListDevices(listProc);
             
             startProcess(settings.VIDEO_DEVICE);
        }
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
