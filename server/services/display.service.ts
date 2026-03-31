import GlobalThis from '../global';
declare const global: GlobalThis;
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import settings from "../config/index";
import { OledService } from './oled.service';

const bmp = require('bmp-js');

export class DisplayService {
    private static instance: DisplayService;
    private pythonProcess: ChildProcess | null = null;
    private isRunning = false;
    private currentEmotion: string = 'neutral';
    private emotionTimeout: NodeJS.Timeout | null = null;

    private constructor() {
        this.init();
    }

    public static getInstance(): DisplayService {
        if (!DisplayService.instance) {
            DisplayService.instance = new DisplayService();
        }
        return DisplayService.instance;
    }

    private init() {
        if (!settings.IS_LINUX) {
            console.log(global.color('yellow', '[Display]\t'), 'Not Linux. Display service disabled.');
            return;
        }

        const scriptPath = path.join(__dirname, '../tools/display/display.py');
        
        // On Pi 4, WS2812 LEDs usually require root privileges for PWM/DMA access.
        // We try to spawn with 'sudo' if possible, or just standard python3 if running as root.
        // You might need to edit /etc/sudoers to allow this script without password.
        const command = 'sudo'; 
        const args = ['python3', '-u', scriptPath];

        console.log(global.color('yellow', '[Display]\t'), `Spawning LED controller (needs root)...`);

        // Set CWD to the script folder so it can find local files like lamp.hex
        this.pythonProcess = spawn(command, args, {
            cwd: path.dirname(scriptPath),
            stdio: ['pipe', 'pipe', 'pipe'] 
        });

        this.isRunning = true;
        console.log(global.color('green', '[Display]\t'), 'Service started.');

        this.pythonProcess.stdout?.on('data', (data) => {
            // Optional: log output from python script for debugging
            // console.log(`[Display.py] ${data.toString().trim()}`);
        });

        this.pythonProcess.stderr?.on('data', (data) => {
            console.error(global.color('red', '[Display.py Err]'), data.toString().trim());
        });

        this.pythonProcess.on('close', (code) => {
            console.log(global.color('yellow', '[Display]\t'), `Process exited with code ${code}`);
            this.isRunning = false;
        });
        this.setEmotion('neutral'); // Default emotion on start
    }

    public setEmotion(emotion: string) {
        let filename = emotion.toLowerCase();
        const basePath = path.join(__dirname, '../tools/display');
        switch (emotion) {
            case 'sad': filename = 'eyesSad'; break;
            case 'joy': filename = 'eyesHappy'; break;
            case 'anger': filename = 'eyesF'; break;
            case 'stun': filename = 'redCircle'; break;
            case 'surprise': filename = 'eyesSurpri'; break;
            case 'processing': filename = 'eyes'; break;
            case 'none': 
            case 'neutral': {
                this.runRandomEmotion();
                filename = 'eyes'; break;
            }
            case 'clip': filename = 'eyesClip'; break;
            case 'cool': filename = 'glasses'; break;
            case 'eyesRandom': {
              switch (Math.floor(Math.random() * 10)) {
                case 0: filename = 'eyesR'; break;
                case 1: filename = 'eyesL'; break;
                case 2: filename = 'eyesT'; break;
                case 3: filename = 'eyesTL'; break;
                case 4: filename = 'eyesTR'; break;
                default: filename = 'eyes'; break;
              }  
            } break;
            default: filename = 'eyes'; break;
        }
        OledService.getInstance().emonion(emotion === 'neutral' || emotion === 'eyesRandom' ? "          " : emotion); // Clear text for neutral
        this.currentEmotion = emotion;
        if(emotion !== 'neutral' && emotion !== 'eyesRandom' && emotion !== 'clip') {
            this.stopRandomEmotion();
        }
        // Check if specific file exists first
        let finalPath = path.join(basePath, `${filename}.hex`);

        // If not found, check switch mapping or fallback
        if (!fs.existsSync(finalPath)) {
            console.error(global.color('red', '[Display]\t'), `No emotion ${emotion}`);
            return;
        }
        try {
            const frameData = fs.readFileSync(finalPath);
            if (frameData.length === 512) {
                this.drawFrame(frameData);
                // console.log(global.color('green', '[Display]\t'), `Loaded emotion: ${filename}`);
                return;
            }
        } catch (e) {
            console.error(global.color('red', '[Display]\t'), `Error reading ${filename}`, e);
        }
    }

    public runRandomEmotion() {
        this.stopRandomEmotion(); // Ensure no duplicate intervals
        this.emotionTimeout = setInterval(async () => {
            if(Math.floor(Math.random() * 5) === 0) {
                const oldEmotion = this.currentEmotion;
                this.setEmotion('clip');
                await new Promise(resolve => setTimeout(resolve, 200));
                this.setEmotion(oldEmotion);
            } else this.setEmotion('eyesRandom');
        }, 3000);
    }

    public stopRandomEmotion() {
        if(this.emotionTimeout) {
            clearInterval(this.emotionTimeout);
            this.emotionTimeout = null;
        }
    }

    public setColorGeneric(index: number) {
        const frame = Buffer.alloc(512, index);
        this.drawFrame(frame);
    }
    
    private sendBinary(data: Buffer) {
        if (!this.isRunning || !this.pythonProcess?.stdin) return;
        try {
            this.pythonProcess.stdin.write(data);
        } catch (e) {
            console.error(global.color('red', '[Display]\t'), "Write error:", e);
        }
    }

    public drawFrame(frameData: Buffer) {
        // Command 'D' (0x44) + 512 bytes
        if (frameData.length !== 512) {
             console.warn("Invalid frame size", frameData.length);
             return;
        }
        const cmd = Buffer.from([0x44]);
        this.sendBinary(Buffer.concat([cmd, frameData]));
    }

    public clear() {
        if (!this.isRunning || !this.pythonProcess) return;
        this.sendBinary(Buffer.from([0x43]));
    }

    public lamp(on: boolean) {
        if (!this.isRunning || !this.pythonProcess) return;
        console.log(global.color('green','[Display]\t'), `Lamp ${on ? 'ON' : 'OFF'}`);
        if (on) {
            this.sendBinary(Buffer.from('L'));
        } else {
            this.sendBinary(Buffer.from('N'));
        }
    }

    /*
     * Processes a BMP file from the file system, converts it to palette indices,
     * sends it to the LED matrix, and saves it as a .hex file.
     * @param uploadPath Path to the uploaded BMP file
     * @param targetHexName Name of the output hex file (e.g., 'emotion.hex', 'lamp.hex')
     */
    public processBmp(uploadPath: string, targetHexName: string = 'emotion.hex'): void {
        const fileData = fs.readFileSync(uploadPath);
        
        // Decode BMP
        const bmpData = bmp.decode(fileData);
        // Expect 16x32 = 512 pixels
        
        let processedPixels = Buffer.alloc(512);

        // ROTATION LOGIC:
        // Case A: 16x32 (Already correct)
        // Case B: 32x16 (Need 90 deg rotation)
        
        const isHorizontal = (bmpData.width === 32 && bmpData.height === 16);
        const isVertical = (bmpData.width === 16 && bmpData.height === 32);

        if (!isHorizontal && !isVertical) {
             throw new Error(`Invalid dimensions: ${bmpData.width}x${bmpData.height}. Expected 16x32 or 32x16.`);
        }
        
        // Generate Palette (Same as Python script)
        const PALETTE: {r:number, g:number, b:number}[] = [];
        
        // 0-15: Standard Colors
        const STD_COLORS = [
            [0,0,0], [128,0,0], [0,128,0], [128,128,0], [0,0,128], [128,0,128], [0,128,128], [192,192,192],
            [128,128,128], [255,0,0], [0,255,0], [255,255,0], [0,0,255], [255,0,255], [0,255,255], [255,255,255]
        ];
        STD_COLORS.forEach(c => PALETTE.push({r:c[0], g:c[1], b:c[2]}));

        // 16-231: 6x6x6 Color Cube
        const steps = [0, 95, 135, 175, 215, 255];
        for (const r of steps) {
            for (const g of steps) {
                for (const b of steps) {
                    PALETTE.push({r, g, b});
                }
            }
        }
        
        // 232-255: Grayscale Ramp
        for (let i = 0; i < 24; i++) {
            const v = 8 + (i * 10);
            PALETTE.push({r:v, g:v, b:v});
        }
        
        // Nearest Color Logic
        function getNearestColorIndex(r: number, g: number, b: number): number {
            let bestIdx = 0;
            let minDist = Infinity;
            
            for (let i = 0; i < PALETTE.length; i++) {
                const p = PALETTE[i];
                // Simple Euclidean distance
                const dist = Math.sqrt(Math.pow(r - p.r, 2) + Math.pow(g - p.g, 2) + Math.pow(b - p.b, 2));
                if (dist < minDist) {
                    minDist = dist;
                    bestIdx = i;
                }
            }
            return bestIdx;
        }

        // Iterate over SOURCE image pixels
        for (let y = 0; y < bmpData.height; y++) {
            for (let x = 0; x < bmpData.width; x++) {
                
                // Read Source Pixel color
                const i = (y * bmpData.width + x) * 4;
                const b = bmpData.data[i + 1]; 
                const g = bmpData.data[i + 2]; 
                const r = bmpData.data[i + 3]; 
                
                const idx = getNearestColorIndex(r, g, b);
                
                // Map to TARGET buffer
                let targetIdx = 0;

                if (isVertical) {
                    // 1:1 Mapping
                    targetIdx = y * 16 + x;
                } else {
                    // 90 Deg Clockwise Rotation Correction
                    // Previously: (15 - y, x) resulted in Counter-Clockwise visual on some matrices depending on wiring
                    // If user says it's Counter-Clockwise, we need to flip the logic to be True Clockwise relative to their perception.
                    
                    // Try: (y, 31 - x) -> This is 90 deg Counter-Clockwise in math, but might appear Clockwise for user?
                    // Let's re-evaluate "Clockwise" for image (x,y).
                    // x' = 15 - y
                    // y' = x 
                    // This is mathematically -90 (CW) in screen coords.
                    
                    // If user says it is CCW, let's try the inverse (270 deg / -90 deg relative to that).
                    // Or maybe it's just a simple transpose?
                    // Let's try "Counter-Clockwise" math which might equal "Clockwise" visual if LED strip is wired weirdly? 
                    // No, let's just do the opposite of what I did.
                    
                    // Current (User says CCW): newX = 15 - y, newY = x
                    // Proposed (Should be CW): newX = y, newY = 31 - x
                    
                    const newX = y;
                    const newY = (31 - x);
                    
                    targetIdx = newY * 16 + newX;
                }

                if (targetIdx >= 0 && targetIdx < 512) {
                    processedPixels[targetIdx] = idx;
                }
            }
        }
        this.stopRandomEmotion();
        // 1. Send to Matrix immediately
        this.drawFrame(processedPixels);
        setTimeout(() => {
            this.runRandomEmotion(); // Resume random emotions after a short delay
        }, 10000); // Small delay to ensure frame is sent before file operations
        // 2. Save to file
        const savePath = path.join(__dirname, '../tools/display', targetHexName);
        fs.writeFileSync(savePath, processedPixels);
        
        console.log(global.color('green','[System]\t'), `BMP processed and saved to ${targetHexName}`);
    }

    public setColor(r: number, g: number, b: number) {
        // Approximate nearest color in palette is hard without logic,
        // so we default to standard color indices or just use a fixed one.
        // For now, let's map simply:
        let idx = 7; // Default White/Gray
        if (r > 200 && g < 50) idx = 9; // Red
        else if (g > 200 && r < 50) idx = 10; // Green
        else if (b > 200) idx = 12; // Blue
        
        const frame = Buffer.alloc(512, idx);
        this.drawFrame(frame);
    }

    public stop() {
        if (this.pythonProcess) {
            console.log(global.color('yellow', '[Display]\t'), 'Stopping LED controller...');
            this.clear(); // Try to clear first
            setTimeout(() => {
                try {
                   this.pythonProcess?.kill('SIGINT');
                } catch(e) {}
            }, 100);
        }
    }
}
