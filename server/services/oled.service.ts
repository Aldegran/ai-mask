import GlobalThis from '../global';
declare const global: GlobalThis;
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import settings from "../config/index";
import os from 'os';
import fs from 'fs';

export class OledService {
    private static instance: OledService;
    private pythonProcess: ChildProcess | null = null;
    private isRunning = false;
    private intervalId: NodeJS.Timeout | null = null;
    private lastCpuIdle: number = 0;
    private lastCpuTotal: number = 0;
    private lastNetRx: number = 0;
    private lastNetTime: number = 0;

    private constructor() {
        this.init();
    }

    public static getInstance(): OledService {
        if (!OledService.instance) {
            OledService.instance = new OledService();
        }
        return OledService.instance;
    }

    private init() {
        if (!settings.IS_LINUX) {
            console.log(global.color('yellow', '[OLED]\t\t'), 'Not Linux. OLED service disabled.');
            return;
        }

        const scriptPath = path.join(__dirname, '../tools/ar/oled.py');
        
        // Для I2C обычно не нужен sudo, если пользователь в группе i2c
        const command = 'python3'; 
        const args = ['-u', scriptPath];

        console.log(global.color('yellow', '[OLED]\t\t'), `Spawning OLED controller...`);

        this.pythonProcess = spawn(command, args, {
            cwd: path.dirname(scriptPath),
            stdio: ['pipe', 'pipe', 'pipe'] 
        });

        this.isRunning = true;

        this.pythonProcess.stdout?.on('data', (data) => {
            const output = data.toString().trim();
            if (output === 'READY') {
                console.log(global.color('green', '[OLED]\t\t'), 'Service ready.');
                // Очищаем экран и выводим приветствие
                // Длина "Запуск..." = 9 символов * 6 пикс = 54 пикс.
                // Экран 64х32, центрируем: x = (64-54)/2 = 5, y = (32-8)/2 = 12
                this.sendBatch([
                    { c: 'clear' },
                    { c: 'rec', x0:27, y0:6, x1:63, y1:8, co:1, f:0 }
                ]);
                this.worker();
                this.intervalId = setInterval(() => this.worker(), 3000);
            } else {
                // Если скрипт будет что-то выводить еще
                // console.log(`[OLED.py] ${output}`);
            }
        });

        this.pythonProcess.stderr?.on('data', (data) => {
            console.error(global.color('red', '[OLED.py Err]\t'), data.toString().trim());
        });

        this.pythonProcess.on('close', (code) => {
            console.log(global.color('yellow', '[OLED]\t\t'), `Process exited with code ${code}`);
            this.isRunning = false;
        });
    }

    /**
     * Отправка одиночной команды
     */
    private sendCommand(cmd: any) {
        if (!this.isRunning || !this.pythonProcess?.stdin || !global.useModules.oled) return;
        try {
            this.pythonProcess.stdin.write(JSON.stringify(cmd) + '\n');
        } catch (e) {
            console.error(global.color('red', '[OLED]\t\t'), "Write error:", e);
        }
    }

    private worker() {
        //this.voiceChanger(true);
        //this.textToAudioParse(true);
        //this.keyboardStatus(global.useModules.keyboard, false);
        //this.keyboardStatus(true, false);
        //this.lampStatus(true);
        //this.AIStatus(true);
        //this.sessionTime("06:32");
        ///this.emonion("angry");
        //this.thinkStatus("Починаємо тести...");
        
        if (settings.IS_LINUX) {
            // Подсчет сетевой скорости
            let rxBytes = 0;
            try {
                const netDev = fs.readFileSync('/proc/net/dev', 'utf8');
                const lines = netDev.split('\n');
                for (const line of lines) {
                    if (line.includes(':') && !line.includes('lo:')) {
                        const parts = line.split(':')[1].trim().split(/\s+/);
                        rxBytes += parseInt(parts[0], 10); // Входящие пакеты в байтах
                    }
                }
            } catch (e) {}

            const now = Date.now();
            if (this.lastNetTime > 0) {
                const timeDiff = (now - this.lastNetTime) / 1000;
                const speedKbps = Math.round(((rxBytes - this.lastNetRx) / timeDiff) / 1024);
                this.link(Math.max(0, speedKbps));
            } else {
                this.link(0);
            }
            this.lastNetRx = rxBytes;
            this.lastNetTime = now;

            let idle = 0;
            let total = 0;
            for (const cpu of os.cpus()) {
                for (const type in cpu.times) {
                    total += cpu.times[type as keyof typeof cpu.times];
                }
                idle += cpu.times.idle;
            }
            const idleDiff = idle - this.lastCpuIdle;
            const totalDiff = total - this.lastCpuTotal;
            const cpuUsage = this.lastCpuTotal === 0 ? 0 : Math.round(100 * (1 - idleDiff / totalDiff));
            this.lastCpuIdle = idle;
            this.lastCpuTotal = total;

            this.bar(cpuUsage);
            ///
            let cpuTemp = 0;
            try {
                const tempStr = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8');
                cpuTemp = Math.round(parseInt(tempStr, 10) / 1000);
            } catch (e) {
                // Если не удается прочитать температуру (например, на Windows)
            }
            this.temperature(cpuTemp);
            ///
            const interfaces = os.networkInterfaces();
            let isWifiConnected = false;
            for (const [name, ifaces] of Object.entries(interfaces)) {
                if (name.startsWith('wl') && ifaces) { // Ищем интерфейсы wlan0, wlp2s0 и т.д.
                    if (ifaces.some(i => i.family === 'IPv4' && !i.internal)) {
                        isWifiConnected = true;
                        break;
                    }
                }
            }
            this.wifiStatus(isWifiConnected);
        }
    }

    /**
     * Отправка массива команд для мгновенной отрисовки за 1 кадр
     */
    public sendBatch(cmds: any[]) {
        if (!this.isRunning || !this.pythonProcess?.stdin || !global.useModules.oled) return;
        try {
            this.pythonProcess.stdin.write(JSON.stringify(cmds) + '\n');
        } catch (e) {
            console.error(global.color('red', '[OLED]\t\t'), "Write error:", e);
        }
    }

    public clear() {
        this.sendCommand({ c: 'clear' });
    }

    public drawIcon(n: string, x: number = 0, y: number = 0, b: number = 0) {
        this.sendCommand({ c: 'icon', n, x, y, b });
    }

    public drawText(t: string, x: number = 0, y: number = 0) {
        this.sendCommand({ c: 'text', t, x, y });
    }

    public drawMicroText(t: string, x: number = 0, y: number = 0) {
        this.sendCommand({ c: 'micro', t, x, y });
    }

    public runText(t: string, y: number = 0, s: number = 40, i: number = 1) {
        this.sendCommand({ c: 'run', t, y, s, i });
    }

    public drawRect(x0: number, y0: number, x1: number, y1: number, co: number = 1, f: number = 0) {
        this.sendCommand({ c: 'rec', x0, y0, x1, y1, co, f });
    }

    public drawLineH(x: number, y: number, l: number, co: number = 1) {
        this.sendCommand({ c: 'lineH', x, y, l, co });
    }

    public drawLineV(x: number, y: number, l: number, co: number = 1) {
        this.sendCommand({ c: 'lineV', x, y, l, co });
    }

    public drawDot(x: number, y: number, co: number = 1) {
        this.sendCommand({ c: 'dot', x, y, co });
    }

    public stop() {
        if (this.pythonProcess) {
            console.log(global.color('yellow', '[OLED]\t\t'), 'Stopping OLED controller...');
            this.clear();
            setTimeout(() => {
                try {
                   // Закрываем stdin, что приведет к нормальному выходу из цикла for line in sys.stdin в питоне
                   this.pythonProcess?.stdin?.end();
                   this.pythonProcess?.kill('SIGINT');
                } catch(e) {}
            }, 100);
        }
        if(this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }
    ////

    public voiceChanger(active: boolean) {
        this.drawIcon('Audio', 9, 0, active ? 2 : 0);
    }
    public textToAudioParse(active: boolean) {
        this.drawIcon('Sound', 0, 0, active ? 2 : 0);
    }
    public textToAudioDirect(active: boolean) {
        this.drawIcon('Sound2', 0, 0, active ? 2 : 0);
    }
    public TTSStatus(active: boolean) {
        this.drawIcon('TTS', 18, 0, active ? 1 : 0);
    }
    public keyboardStatus(active: boolean, connecting: boolean) {
        this.drawIcon('Bluetooth', 48, 24, connecting ? 2 : (active ? 1 : 0));
    }
    public wifiStatus(active: boolean) {
        this.drawIcon('Wifi', 56, 24, active ? 1 : 2);
    }
    public lampStatus(active: boolean) {
        this.drawIcon('Light', 40, 24, active ? 1 : 0);
    }
    public AIStatus(active: boolean) {
        this.drawIcon('AI', 32, 24, active ? 1 : 0);
    }
    public thinkStatus(text: string) {
        this.runText(text, 9, 40, 1);
    }
    public temperature(temp: number) {
        const text = temp > 10 ? temp.toString() : " "+temp.toString();
        this.drawMicroText(text+'°', 27, 0);
    }
    public sessionTime(time: string) {
        this.drawMicroText(time, 0, 27);
    }
    public link(value: number) {
        let text = value.toString();
        if(value < 1000) {
            text = ' '+text;
            if(value < 100) {
                text = ' '+text;
                if(value < 10) text = ' '+text;
            }
        }
        this.drawMicroText(text+'k', 40, 0);
    }
    public emonion(emonion: string) {
        if(emonion && emonion.length > 10) emonion = emonion.slice(0,10);
        if(!emonion) emonion = '          ';
        this.drawMicroText(emonion, 40, 0);
    }
    public bar(value: number) {
        if(value > 100) value = 100;
        if(value < 0) value = 0;
        const length = Math.round((value / 100) * 27);
        this.sendBatch([
            { c: 'rec', x0:28, y0:7, x1:28+length, y1:7, co:1, f:0 },
            { c: 'rec', x0:28+length, y0:7, x1:62, y1:7, co:0, f:0 }
        ]);
    }
}
