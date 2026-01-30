import GlobalThis from '../global';
declare const global: GlobalThis;
import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import settings from '../config/index';

// Configuration for Voice
export const voiceSettings = {
    length_scale: 0.8,//1.2
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

    public get isSaying(): boolean {
        return this.processing['SAY'];
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
            await this.synthesizeAndPlay(text, type);
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
            const piperExe = path.join(piperDir, settings.IS_LINUX ? 'piper' : 'piper.exe');
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
    private async synthesizeAndPlay(text: string, type: string): Promise<Buffer | null> {
        return new Promise((resolve, reject) => {
            if (!text || text.trim().length === 0) {
                return resolve(null);
            }

            const piperDir = path.resolve(__dirname, '../tools/piper'); 
            const piperExe = path.join(piperDir, settings.IS_LINUX ? 'piper' : 'piper.exe');
            const modelPath = path.join(piperDir, `${voiceSettings.model}.onnx`);
            const soxExe = settings.IS_LINUX ? '/usr/bin/sox' : path.resolve(__dirname, '../tools/sox/sox.exe');

            if (!fs.existsSync(piperExe)) {
                console.log(global.color('red',"[TTS]\t"),`Piper executable not found at ${piperExe}`);
                return resolve(null);
            }
            if (!fs.existsSync(modelPath)) {
                console.log(global.color('red',"[TTS]\t"),`Model not found at ${modelPath}`);
                return resolve(null);
            }

            try {
                // 1. Piper Process (Generate to STDOUT as RAW S16LE)
                // We use --output-raw to prevent WAV header generation which causes static in pipes
                const piperArgs = [
                    '--model', modelPath,
                    '--output-raw', // Write raw data to stdout
                    '--speaker', voiceSettings.speaker.toString(),
                    '--length_scale', voiceSettings.length_scale.toString(),
                    '--noise_scale', voiceSettings.noise_scale.toString(),
                    '--noise_w', voiceSettings.noise_w.toString(),
                    '--sentence_silence', voiceSettings.sentence_silence.toString(),
                ];

                const piper = spawn(piperExe, piperArgs);
                
                // Write text input
                piper.stdin.write(text);
                piper.stdin.end();

                // 2. Setup Audio Pipeline
                let audioSource: any = piper.stdout;
                let activeProcessStr = "Piper";

                // Audio Format Constants for Piper Medium Models
                // S16LE 22050Hz Mono is standard for 'medium' onnx models
                const rawFormatArgs = ['-t', 'raw', '-r', '22050', '-b', '16', '-c', '1', '-e', 'signed-integer'];

                // If Voice Changer is Enabled & SoX exists
                if (settings.USE_VOICE_CHANGER && fs.existsSync(soxExe)) {
                    activeProcessStr = "Piper -> SoX";
                    
                    // SoX Speed = 1 / Piper Length Scale (Inverse relationship)
                    const soxSpeed = (1 / voiceSettings.length_scale).toFixed(4);
                    
                    const effectArgs = settings.SOX_PARAMS
                        .replace('[s]', soxSpeed)
                        .split(' ')
                        .filter(x => x.length > 0);

                    // SoX Filter: Input Raw -> Output Raw (with effects)
                    const sox = spawn(soxExe, [
                        ...rawFormatArgs, '-', // Input
                        ...rawFormatArgs, '-', // Output
                        ...effectArgs
                    ]);

                    sox.on('error', (err) => console.error('[TTS] SoX Process Error:', err));
                    
                    // Pipe Piper -> SoX
                    piper.stdout.pipe(sox.stdin);
                    
                    // Now our source is SoX's output
                    audioSource = sox.stdout;
                }

                // 3. Capture Result
                const chunks: Buffer[] = [];
                audioSource.on('data', (chunk: Buffer) => chunks.push(chunk));

                // Capture Piper logs for debug
                let stderrLog = "";
                piper.stderr.on('data', (d: any) => stderrLog += d.toString());

                // On Stream Finish
                audioSource.on('end', () => {
                   const audioBuffer = Buffer.concat(chunks);
                   
                   if (audioBuffer.length === 0) {
                       console.log(global.color('red',"[TTS]\t"),`Audio generation empty (${activeProcessStr}).`);
                       return resolve(null);
                   }

                   // 4. Playback Logic
                   const mode = process.env.AUDIO_OUTPUT_MODE || 'default';

                   if (mode === 'web') {
                       // Create WAV Header for Client/Browser Compatibility (RAW -> WAV)
                       const wavHeader = Buffer.alloc(44);
                       wavHeader.write('RIFF', 0);
                       wavHeader.writeUInt32LE(36 + audioBuffer.length, 4); // ChunkSize
                       wavHeader.write('WAVE', 8);
                       wavHeader.write('fmt ', 12);
                       wavHeader.writeUInt32LE(16, 16); // Subchunk1Size
                       wavHeader.writeUInt16LE(1, 20);  // AudioFormat (1 = PCM)
                       wavHeader.writeUInt16LE(1, 22);  // NumChannels (1 = Mono)
                       wavHeader.writeUInt32LE(22050, 24); // SampleRate
                       wavHeader.writeUInt32LE(22050 * 1 * 16 / 8, 28); // ByteRate
                       wavHeader.writeUInt16LE(1 * 16 / 8, 32); // BlockAlign
                       wavHeader.writeUInt16LE(16, 34); // BitsPerSample
                       wavHeader.write('data', 36);
                       wavHeader.writeUInt32LE(audioBuffer.length, 40); // Subchunk2Size

                       const wavBuffer = Buffer.concat([wavHeader, audioBuffer]);
                       
                       // Only emit to socket/web if in web mode
                       this.emit('audio', wavBuffer); 
                       
                       // Web Mode Simulation (Virtual Delay)
                       const bytesPerSecond = 44100; // 22050 * 2
                       const durationMs = (audioBuffer.length / bytesPerSecond) * 1000;
                       setTimeout(() => resolve(audioBuffer), durationMs);
                   } else {
                        // Local playback mode (SAY -> PI, WHISPER -> EXT)
                        let device = 'default';
                        if (type === 'SAY') {
                            device = process.env.PI_SPEAKER_NAME || 'hw:0,0';
                        } else if (type === 'WHISPER') {
                            device = process.env.EXT_SPEAKER_NAME || 'hw:3,0';
                        }

                        if (fs.existsSync(soxExe)) {
                            // Use SoX to play the raw memory buffer directly to the selected speaker
                            // Output format for ALSA device: -t alsa <device>
                            const driver = settings.IS_LINUX ? 'alsa' : 'waveaudio';
                            const player = spawn(soxExe, [...rawFormatArgs, '-', '-t', driver, device, '-q']);
                            player.stdin.write(audioBuffer);
                            player.stdin.end();
                            
                            player.on('close', () => resolve(audioBuffer));
                            player.on('error', (err) => {
                                console.error("[TTS] Local playback error:", err);
                                resolve(audioBuffer);
                            });
                        } else {
                            console.log(global.color('red',"[TTS]\t"), "SoX missing for local playback.");
                            resolve(audioBuffer);
                        }
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
