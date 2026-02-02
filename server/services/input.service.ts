import GlobalThis from '../global';
declare const global: GlobalThis;
import fs from 'fs';
import { keyboardActions } from '../config/commands';
import settings from "../config/index";

interface InputEvent {
    time: { tv_sec: number; tv_usec: number };
    type: number;
    code: number;
    value: number;
}

export class InputService {
    private static instance: InputService;
    private streams: fs.ReadStream[] = [];
    private readonly EVENT_SIZE = 24; 
    private isScanning = false;
    private isStopped = false; // Prevent reconnects on shutdown

    private constructor() {
        this.init();
    }

    public static getInstance(): InputService {
        if (!InputService.instance) {
            InputService.instance = new InputService();
        }
        return InputService.instance;
    }

    // Explicitly clean up resources
    public stop() {
        this.isStopped = true;
        this.isScanning = false;
        
        // Close all active streams
        this.streams.forEach(s => {
             try { s.destroy(); } catch(e){}
        });
        this.streams = [];
        console.log(global.color('yellow',`[Input]\t`),'Service stopped.');
    }

    private async init() {
        if (this.isScanning || this.isStopped) return;
        this.isScanning = true;

        if (!settings.IS_LINUX) {
             console.log(global.color('yellow',`[Input]\t`),'Not Linux detected. BT/USB direct input disabled. Waiting for Web Input.');
             return;
        }

        //console.log("InputService: Scanning for input devices...");
        const devicePaths = await this.findAllDevicePaths("VR BOX"); // Or ST17H26
        
        if (devicePaths.length > 0) {
            console.log(global.color('green',`[KeyboardBT]\t`),'Found devices');
            devicePaths.forEach(path => this.startReading(path));
            this.isScanning = false;
        } else {
            console.log(global.color('yellow',`[KeyboardBT]\t`),'VR BOX remote not found. Waiting/Retrying...');
            setTimeout(() => {
                this.isScanning = false;
                this.init();
            }, 3000);
        }
    }

    public handleWebInput(key: string, action: 'press' | 'release') {
        let keyName = '';
        const act = action; // 'press' or 'release'

        /* 
           Web Mapping:
           Space -> BOTTOM
           Enter -> TOP
           1 -> A
           2 -> C
           3 -> B
           4 -> D
        */

        if (key === ' ' || key === 'Spacebar') keyName = 'BOTTOM';
        else if (key === 'Enter') keyName = 'TOP';
        else if (key === '1') keyName = 'A';
        else if (key === '2') keyName = 'C';
        else if (key === '3') keyName = 'B';
        else if (key === '4') keyName = 'D';

        if (keyName && keyboardActions[keyName]) {
             // Avoid spamming logs for repeating keys if needed, but for now log it
             console.log(global.color('cyan',`[WebInput]\t`),`${keyName} [${act.toUpperCase()}]`);
             if (keyboardActions[keyName][act]) {
                 keyboardActions[keyName][act]();
             }
        }
    }

    private async findAllDevicePaths(searchName: string): Promise<string[]> {
        const paths: string[] = [];
        try {
            const devicesInfo = fs.readFileSync('/proc/bus/input/devices', 'utf-8');
            const devices = devicesInfo.split('\n\n');

            for (const device of devices) {
                // Skip mouse devices to save resources/threads
                if (device.includes("Mouse")) continue;

                if (device.includes(searchName) || device.includes('ST17H26')) {
                    const handlerMatch = device.match(/H: Handlers=.*(event\d+)/);
                    if (handlerMatch && handlerMatch[1]) {
                        paths.push(`/dev/input/${handlerMatch[1]}`);
                    }
                }
            }
        } catch (error) {
            console.log(global.color('red',`[KeyboardBT]\t`),"Error reading devices info", error);
        }
        return paths;
    }

    private startReading(path: string) {
        try {
            const stream = fs.createReadStream(path);
            this.streams.push(stream);
            console.log(`\t\t Listening on ${path}`);

            let buffer = Buffer.alloc(0);

            stream.on('data', (chunk: Buffer) => {
                // Debug raw data flow
                // console.log(global.color('gray',`[KeyboardBT]\t`), `Received chuck ${chunk.length} bytes from ${path}`);
                
                buffer = Buffer.concat([buffer, chunk]);

                while (buffer.length >= this.EVENT_SIZE) {
                    const eventData = buffer.slice(0, this.EVENT_SIZE);
                    buffer = buffer.slice(this.EVENT_SIZE);
                    this.parseEvent(eventData, path);
                }
            });

            stream.on('error', (err: any) => {
                 if (err.code === 'ENODEV') {
                    // Expected when device physically disconnects
                    console.log(global.color('yellow',`[KeyboardBT]\t`), `Device removed: ${path}`);
                 } else {
                    console.log(global.color('red',`[KeyboardBT]\t`), `Stream error on ${path}`, err.message);
                 }
                 this.handleDisconnect(stream);
            });
            
            stream.on('close', () => {
                 this.handleDisconnect(stream);
            });

        } catch (err) {
            console.log(global.color('red',`[KeyboardBT]\t`), `Failed to open device ${path}`, err);
        }
    }

    private handleDisconnect(stream: fs.ReadStream) {
        if (this.streams.includes(stream)) {
            // console.log(global.color('yellow',`[KeyboardBT]\t`), `Cleaning up stream...`);
            stream.destroy();
            this.streams = this.streams.filter(s => s !== stream);
        }
        
        // If all devices lost, restart scanning immediately
        if (this.streams.length === 0 && !this.isScanning && !this.isStopped) {
            console.log(global.color('yellow',`[KeyboardBT]\t`),'Connection lost. Reconnecting...');
            this.init();
        }
    }

    private parseEvent(buffer: Buffer, path: string) {
        // Parse struct input_event
        const type = buffer.readUInt16LE(16);
        const code = buffer.readUInt16LE(18);
        const value = buffer.readInt32LE(20);
        
        // Type 0 is EV_SYN (Synchronization), acting as a heartbeat
        if (type === 0) {
            // Heartbeat received
            return;
        }

        if (type === 1) { // EV_KEY
            let action = 'UNKNOWN';

            if (value === 0) action = 'RELEASE';
            if (value === 1) action = 'PRESS';
            if (value === 2) action = 'REPEAT';

           let keyName = '';
            
            if ([304, 310,272].includes(code)) keyName = 'BOTTOM';
            else if ([305, 311,273].includes(code)) keyName = 'TOP';
            else if ([164,308,313].includes(code)) keyName = 'A';
            else if ([307,312,114,115].includes(code)) keyName = 'C';
            //else if (code == 304) keyName = 'B';
            //else if (code == 305) keyName = 'D';
            
            if(keyName){
              if (action !== 'REPEAT') { // Clean up logs, ignore repeats if needed
                console.log(global.color('cyan',`[INPUT]\t`),`${keyName} [${action}]`);
                keyboardActions[ keyName ][value ? 'press' : 'release']();
              }
            } else {
              //console.log(global.color('gray',`[INPUT]\t`),`UNKNOWN CODE: ${code} Value: ${value} from ${path}`);
            }
        }
    }
}
