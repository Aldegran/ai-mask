import GlobalThis from '../global';
declare const global: GlobalThis;
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import EventEmitter from 'events';
import settings from '../config/index';

/**
 * VIDEO_DETAIL presets (controlled via .env VIDEO_DETAIL=high|low)
 *
 * high — 640×480, JPEG q=5  → GPT: 2 tiles × 425 tok/frame  (~1.2 min on 32K ctx)
 * low  — 320×240, JPEG q=15 → GPT: detail="low" × 85 tok/frame (~43 min on 32K ctx)
 *
 * GPT token math:
 *   high (640×480, detail=auto): ceil(640/512)×ceil(480/512)=2 tiles → 85+170×2 = 425 tok
 *   low  (320×240, detail=low):  always flat 85 tok regardless of resolution
 */
const VIDEO_PRESETS = {
    high: { width: 640, height: 480, quality: 5,  gptDetail: 'auto' as const },
    low:  { width: 320, height: 240, quality: 15, gptDetail: 'low'  as const },
};

export type VideoDetail = keyof typeof VIDEO_PRESETS;

export class VideoService extends EventEmitter {
    private static instance: VideoService;
    private ffmpegProcess: any;
    private buffer: Buffer = Buffer.alloc(0);
    private isRunning: boolean = false;

    private readonly preset = VIDEO_PRESETS[settings.VIDEO_DETAIL] ?? VIDEO_PRESETS.high;

    // Throttling logic
    private lastFrameTime: number = 0;
    private frameInterval: number = 1000 / settings.FPS;

    /** Returns the GPT detail level for the active preset ('auto' | 'low') */
    public getGptDetail(): 'auto' | 'low' {
        return this.preset.gptDetail;
    }

    /** Returns active capture dimensions and quality for status/UI endpoints */
    public getPreset() {
        return { ...this.preset, name: settings.VIDEO_DETAIL };
    }

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
            const { width, height, quality } = this.preset;
            console.log(global.color('green','[Video]\t\t'), 'Connecting to device:', global.color('yellow', deviceName));
            console.log(global.color('green','[Video]\t\t'), `Preset: ${global.color('cyan', settings.VIDEO_DETAIL)} (${width}×${height}, q=${quality}, gpt-detail=${this.preset.gptDetail})`);
            
            if (settings.IS_LINUX) {
                // Raspberry Pi Camera using rpicam-vid (modern libcamera stack)
                const args = [
                    '-t', '0',
                    '--width',  width.toString(),
                    '--height', height.toString(),
                    '--framerate', settings.CAMERA_FPS.toString(),
                    '--codec', 'mjpeg',
                    '--rotation', '180',
                    '-n',
                    '-o', '-'
                ];
                
                this.ffmpegProcess = spawn('rpicam-vid', args);
            } else {
                const args = [
                    '-f', 'dshow',
                    '-video_size', `${width}x${height}`,
                    '-rtbufsize', '100M',
                    '-i', `video=${deviceName}`,
                    '-r', settings.CAMERA_FPS.toString(),
                    '-c:v', 'mjpeg',
                    '-q:v', quality.toString(),
                    '-f', 'image2pipe',
                    'pipe:1'
                ];
                this.ffmpegProcess = spawn(ffmpegPath, args);
            }

            this.ffmpegProcess.stdout.on('data', (chunk: Buffer) => {
                this.handleData(chunk);
            });

            this.ffmpegProcess.stderr.on('data', (data: Buffer) => {
                const s = data.toString();
                if (s.includes('INFO')) return;
                if (s.includes('WARN')) return; // libcamera udev/hotplug noise — harmless
                console.log(global.color('red','[Video]\t\t'), `stderr: ${s}`);
            });

            this.ffmpegProcess.on('error', (err: any) => {
                console.log(global.color('red','[Video]\t\t'),'Video Process Error:', err);
                this.isRunning = false;
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
