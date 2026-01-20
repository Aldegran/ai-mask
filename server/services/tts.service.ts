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

    private constructor() {
        super();
    }

    public static getInstance(): TTSService {
        if (!TTSService.instance) {
            TTSService.instance = new TTSService();
        }
        return TTSService.instance;
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
                console.error(`[TTS] Piper executable not found at ${piperExe}`);
                return resolve(false);
            }
            if (!fs.existsSync(modelPath)) {
                console.error(`[TTS] Model not found at ${modelPath}`);
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
                        console.error(`[TTS] Piper process exited with code ${code}`);
                        return resolve(false);
                    }
                    resolve(true);
                });

                piper.on('error', (err) => {
                    console.error("[TTS] Process error:", err);
                    resolve(false);
                });

            } catch (e) {
                console.error("[TTS] Exception:", e);
                resolve(false);
            }
        });
    }

    /**
     * Synthesizes speech from text and emits an 'audio' event with the WAV buffer.
     */
    public async speak(text: string): Promise<Buffer | null> {
        return new Promise((resolve, reject) => {
            if (!text || text.trim().length === 0) {
                return resolve(null);
            }

            console.log(`[TTS] Generating audio for: "${text}"`);
            this.isGenerating = true;

            const piperDir = path.resolve(__dirname, '../tools/piper'); 
            const piperExe = path.join(piperDir, 'piper.exe'); 
            const modelPath = path.join(piperDir, `${voiceSettings.model}.onnx`);
            const outputWav = path.join(piperDir, 'output.wav');

            if (!fs.existsSync(piperExe)) {
                console.error(`[TTS] Piper executable not found at ${piperExe}`);
                this.isGenerating = false;
                return resolve(null);
            }
            if (!fs.existsSync(modelPath)) {
                console.error(`[TTS] Model not found at ${modelPath}`);
                this.isGenerating = false;
                return resolve(null);
            }

            try {
                const piper = spawn(piperExe, [
                    '--model', modelPath,
                    '--output_file', outputWav,
                    '--speaker', voiceSettings.speaker.toString(), // Some models act up if speaker ID is passed for single-speaker models. The UA model is likely single speaker.
                    '--length_scale', voiceSettings.length_scale.toString(),
                    '--noise_scale', voiceSettings.noise_scale.toString(),
                    '--noise_w', voiceSettings.noise_w.toString(),
                    '--sentence_silence', voiceSettings.sentence_silence.toString(),
                ]);

                // Handle process input
                piper.stdin.write(text);
                piper.stdin.end();

                let stderrLog = "";
                piper.stderr.on('data', (d) => stderrLog += d);

                piper.on('close', (code) => {
                    this.isGenerating = false;
                    
                    if (code !== 0) {
                        console.error(`[TTS] Piper process exited with code ${code}`);
                        console.error(stderrLog);
                        return resolve(null);
                    }

                    // Read the output file
                    try {
                        if (fs.existsSync(outputWav)) {
                            const audioBuffer = fs.readFileSync(outputWav);
                            console.log(`[TTS] Generated ${audioBuffer.length} bytes.`);
                            
                            // Emit the audio for listeners (e.g. WebSocket broadcaster)
                            this.emit('audio', audioBuffer);

                            // Local Playback for "Earpiece" (Windows)
                            if (process.env.AUDIO_OUTPUT_MODE === 'default' && process.platform === 'win32') {
                                const psPlay = `(New-Object Media.SoundPlayer "${outputWav}").PlaySync()`;
                                exec(`powershell -c "${psPlay}"`, (err) => {
                                    if (err) console.error("[TTS] Local playback error:", err);
                                });
                            }
                            
                            resolve(audioBuffer);
                        } else {
                            console.error("[TTS] Output file not found after generation.");
                            resolve(null);
                        }
                    } catch (readErr) {
                        console.error("[TTS] Error reading output file:", readErr);
                        resolve(null);
                    }
                });

                piper.on('error', (err) => {
                    console.error("[TTS] Process error:", err);
                    this.isGenerating = false;
                    resolve(null);
                });

            } catch (e) {
                console.error("[TTS] Exception:", e);
                this.isGenerating = false;
                resolve(null);
            }
        });
    }
}
