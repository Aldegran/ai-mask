import GlobalThis from '../global';
declare const global: GlobalThis;
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import settings from "../config/index";

export class OledService {
    private static instance: OledService;
    private pythonProcess: ChildProcess | null = null;
    private isRunning = false;

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
                    { c: 'text', t: 'Запуск...', x: 5, y: 12 }
                ]);
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
        if (!this.isRunning || !this.pythonProcess?.stdin) return;
        try {
            this.pythonProcess.stdin.write(JSON.stringify(cmd) + '\n');
        } catch (e) {
            console.error(global.color('red', '[OLED]\t\t'), "Write error:", e);
        }
    }

    /**
     * Отправка массива команд для мгновенной отрисовки за 1 кадр
     */
    public sendBatch(cmds: any[]) {
        if (!this.isRunning || !this.pythonProcess?.stdin) return;
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
    }
}
