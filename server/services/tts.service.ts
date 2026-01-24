import GlobalThis from '../global';
declare const global: GlobalThis;
import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';

// Configuration for Voice
const voiceSettings = {
    length_scale: 0.9,//1.2
    noise_scale: 0.01,//0.667
    noise_w: 0.1,//0.8
    sentence_silence : 0.2,
    speaker: 1,
    model: 'uk_UA-ukrainian_tts-medium',//'uk_UA-model'
};

export class TTSService extends EventEmitter {
    private static instance: TTSService;
    private isGenerating: boolean = false;
    
    // Separate queues for different output channels
    private queues: Record<string, string[]> = {
        'SAY': [],
        'WHISPER': []
    };
    private processing: Record<string, boolean> = {
        'SAY': false,
        'WHISPER': false
    };

    private constructor() {
        super();
    }

    public static getInstance(): TTSService {
        if (!TTSService.instance) {
            TTSService.instance = new TTSService();
        }
        return TTSService.instance;
    }

    public speak(text: string, type: string) {
        if (!text || text.trim().length === 0) return;
        
        // Normalize type (default to SAY if not WHISPER)
        const target = (type === 'WHISPER') ? 'WHISPER' : 'SAY';
        
        this.queues[target].push(text);
        this.processQueue(target);
    }

    private async processQueue(type: string) {
        if (this.processing[type] || this.queues[type].length === 0) return;

        this.processing[type] = true;
        const text = this.queues[type].shift();

        if (text) {
            const filename = `${type.toLowerCase()}_${Date.now()}`; // say_123.wav or whisper_123.wav
            await this.synthesizeAndPlay(text, filename);
        }

        this.processing[type] = false;
        
        // Continue if items remain
        if (this.queues[type].length > 0) {
            this.processQueue(type);
        }
    }

    /**
     * Generates a WAV file from the given text at a specific path.
     */
    public async genWav(text: string, filename: string): Promise<boolean> {
        return new Promise((resolve) => {
            if (!text || text.trim().length === 0) {
                return resolve(false);
            }

            const piperDir = path.resolve(__dirname, '../tools/piper');
            const piperExe = path.join(piperDir, 'piper.exe');
            const modelPath = path.join(piperDir, `${voiceSettings.model}.onnx`);
            
            // Ensure filename is absolute or relative to piperDir if desired, 
            // but usually caller provides a path. We'll use it directly if absolute,
            // or resolve relative to CWD if not.
            // For safety in this context, let's assume filename is a full path or simple name.
            const outputWav = path.isAbsolute(filename) ? filename : path.join(process.cwd(), filename);

            if (!fs.existsSync(piperExe)) {
                console.log(global.color('red',"[TTS]\t"),`Piper executable not found at ${piperExe}`);
                return resolve(false);
            }
            if (!fs.existsSync(modelPath)) {
                console.log(global.color('red',"[TTS]\t"),`Model not found at ${modelPath}`);
                return resolve(false);
            }

            try {
                const piper = spawn(piperExe, [
                    '--model', modelPath,
                    '--output_file', outputWav,
                    '--speaker', voiceSettings.speaker.toString(),
                    '--length_scale', voiceSettings.length_scale.toString(),
                    '--noise_scale', voiceSettings.noise_scale.toString(),
                    '--noise_w', voiceSettings.noise_w.toString(),
                    '--sentence_silence', voiceSettings.sentence_silence.toString(),
                ]);

                // Handle process input
                piper.stdin.write(text);
                piper.stdin.end();

                piper.on('close', (code) => {
                    if (code !== 0) {
                        console.log(global.color('red',"[TTS]\t"),`Piper process exited with code ${code}`);
                        return resolve(false);
                    }
                    resolve(true);
                });

                piper.on('error', (err) => {
                    console.log(global.color('red',"[TTS]\t"),"Process error:", err);
                    resolve(false);
                });

            } catch (e) {
                console.log(global.color('red',"[TTS]\t"),"Exception:", e);
                resolve(false);
            }
        });
    }

    /**
     * Synthesizes speech from text and emits an 'audio' event with the WAV buffer.
     * Internal usage by processQueue.
     */
    private async synthesizeAndPlay(text: string, filename: string): Promise<Buffer | null> {
        return new Promise((resolve, reject) => {
            if (!text || text.trim().length === 0) {
                return resolve(null);
            }

            // console.log(global.color('cyan',"[TTS]\t"),`Generating audio for: "${text}"`);
            // this.isGenerating = true; // Flag legacy

            const piperDir = path.resolve(__dirname, '../tools/piper'); 
            const piperExe = path.join(piperDir, 'piper.exe'); 
            const modelPath = path.join(piperDir, `${voiceSettings.model}.onnx`);
            const outputWav = path.join(piperDir, filename+'.wav');

            if (!fs.existsSync(piperExe)) {
                console.log(global.color('red',"[TTS]\t"),`Piper executable not found at ${piperExe}`);
                return resolve(null);
            }
            if (!fs.existsSync(modelPath)) {
                console.log(global.color('red',"[TTS]\t"),`Model not found at ${modelPath}`);
                return resolve(null);
            }

            try {
                const piper = spawn(piperExe, [
                    '--model', modelPath,
                    '--output_file', outputWav,
                    '--speaker', voiceSettings.speaker.toString(),
                    '--length_scale', voiceSettings.length_scale.toString(),
                    '--noise_scale', voiceSettings.noise_scale.toString(),
                    '--noise_w', voiceSettings.noise_w.toString(),
                    '--sentence_silence', voiceSettings.sentence_silence.toString(),
                ]);

                piper.stdin.write(text);
                piper.stdin.end();

                let stderrLog = "";
                piper.stderr.on('data', (d) => stderrLog += d);

                piper.on('close', (code) => {
                    // this.isGenerating = false; 
                    
                    if (code !== 0) {
                        console.log(global.color('red',"[TTS]\t"),`Piper process exited with code ${code}`);
                        console.log(stderrLog);
                        return resolve(null);
                    }

                    // Read the output file
                    try {
                        if (fs.existsSync(outputWav)) {
                            const audioBuffer = fs.readFileSync(outputWav);
                            this.emit('audio', audioBuffer);

                            // Check Env or Default to 'default'
                            const mode = process.env.AUDIO_OUTPUT_MODE || 'default';

                            // Local Playback for "Earpiece" (Windows)
                            if (mode === 'default' && process.platform === 'win32') {
                                //const currentTime = new Date().toLocaleTimeString('uk-UA'); // HH:mm:ss
                                //console.log(currentTime, global.color('cyan',"[TTS]\t"), `Playing ${filename}...`);
                                
                                const psScript = `(New-Object Media.SoundPlayer "${outputWav}").PlaySync()`;
                                const player = spawn('powershell', ['-c', psScript]);

                                player.on('close', (code) => {
                                    //const currentTime = new Date().toLocaleTimeString('uk-UA'); // HH:mm:ss
                                    //console.log(currentTime, global.color('green',"[TTS]\t"), `Finished ${filename}.`);
                                    try { fs.unlinkSync(outputWav); } catch(e){} 
                                    resolve(audioBuffer);
                                });
                                
                                player.on('error', (err) => {
                                    console.error("Playback error", err);
                                    try { fs.unlinkSync(outputWav); } catch(e){} 
                                    resolve(audioBuffer);
                                });

                            } else {
                                // Web/Network mode: Simulate playback time to maintain queue order
                                // Piper default: 22050Hz, 16bit (2 bytes), Mono (1 channel) => ~44100 bytes/sec
                                // Adding a small buffer factor to ensure separation
                                const bytesPerSecond = 44100;
                                const durationMs = (audioBuffer.length / bytesPerSecond) * 1000;
                                const waitTime = Math.ceil(durationMs);
                                
                                //const currentTime = new Date().toLocaleTimeString('uk-UA'); // HH:mm:ss
                                //console.log(currentTime, global.color('cyan',"[TTS]\t"), `Emitting ${filename} (Virtual Playback: ${waitTime}ms)...`);

                                setTimeout(() => {
                                    // const finishTime = new Date().toLocaleTimeString('uk-UA');
                                    // console.log(finishTime, global.color('green',"[TTS]\t"), `Finished Virtual ${filename}.`);
                                    try { fs.unlinkSync(outputWav); } catch(e){} 
                                    resolve(audioBuffer);
                                }, waitTime);
                            }
                            
                        } else {
                            console.log(global.color('red',"[TTS]\t"),"Output file not found after generation.");
                            resolve(null);
                        }
                    } catch (readErr) {
                        console.log(global.color('red',"[TTS]\t"),"Error reading output file:", readErr);
                        resolve(null);
                    }
                });

                piper.on('error', (err) => {
                    console.log(global.color('red',"[TTS]\t"),"Process error:", err);
                    resolve(null);
                });

            } catch (e) {
                console.log(global.color('red',"[TTS]\t"),"Exception:", e);
                resolve(null);
            }
        });
    }
}
