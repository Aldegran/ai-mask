import GlobalThis from '../global';
declare const global: GlobalThis;
import settings from "./index";
import type { GeminiService } from '../services/gemini.service';
import type { AudioService } from '../services/audio.service';
import type { VideoService } from '../services/video.service';
import type { TTSService } from '../services/tts.service';
import fs from 'fs';

let geminiService: GeminiService | null = null;
let audioService: AudioService | null = null;
let videoService: VideoService | null = null;
let ttsService: TTSService | null = null;

export function setGeminiInstance(instance: GeminiService) {
    geminiService = instance;
}
export function setAudioInstance(instance: AudioService) {
    audioService = instance;
}
export function setVideoInstance(instance: VideoService) {
    videoService = instance;
}
export function setTTSInstance(instance: TTSService) {
    ttsService = instance;
}

interface ServicesConfig {
    work: (data: any) => any;
    interval: number;
    intervalInstance: NodeJS.Timeout | null;
}

export let behaiviorText = "";

function loadBehavior() {
    try {
        if (fs.existsSync('behavior.txt')) {
            behaiviorText = fs.readFileSync('behavior.txt', 'utf-8').trim();
        }
    } catch (e) {
        console.error("Error loading behavior.txt", e);
    }
}
loadBehavior();

export function saveBehaiviorsBuild(text:string): void {
  try {
      behaiviorText = text;
      fs.writeFileSync('behavior.txt', text, 'utf-8');
      console.log(global.color('green', '[System]\t'), "Behavior settings updated.");
  } catch (e) {
      console.error("Error saving behavior.txt", e);
  }
}

export function buildInstruction(): string {
  let systemInstructionText = "";
  try {
      if (fs.existsSync('instruction.txt')) {
          systemInstructionText = fs.readFileSync('instruction.txt', 'utf-8').trim();
      } else {
          console.warn("instruction.txt not found, using default.");
          systemInstructionText = "You are a helpful AI.";
      }
  } catch (e) {
      console.log(global.color('red', '[Gemini]\t'),"Error reading instruction.txt", e);
      return '';
  }
  let contextText = "";
  loadBehavior();
  try {
      if (fs.existsSync('context.txt')) {
          contextText = fs.readFileSync('context.txt', 'utf-8').trim();
          if( contextText.length > 0 ){
              systemInstructionText += '\n' + behaiviorText + settings.DELIM + contextText;
          } else {
              systemInstructionText += '\n' + behaiviorText;
          }
      }
  } catch (e) {
      console.log(global.color('red', '[Gemini]\t'),"Error reading context.txt", e);
      return '';
  }
  return systemInstructionText;
}

export const services: Record<string, ServicesConfig> = {
    'begin': {
        work: (data: any) => {
            console.log(global.color('green','[Context]\t'), 'Created new context');
            fs.writeFile('./context.txt', '', (err) => {
                  if (err) console.error(err);
                });
        },
        interval: 0,
        intervalInstance: null
    },
    'start': {
        work: (data: any) => {
            //if (geminiService) geminiService.sendTextMessage("[CONTEXT]");
        },
        interval: 0,
        intervalInstance: null
    },
    'contextUpdater': {
        work: (data: any) => {
            if (!geminiService) return;
            geminiService.sendTextMessage("[CONTEXT]");
        },
        interval: 60,
        intervalInstance: null
    },
    'contextFast': {
        work: (data: any) => {
            if (!geminiService) return;
            geminiService.sendTextMessage("[CONTEXT]");
        },
        interval: 0,
        intervalInstance: null
    },
    'timeSync': {
        work: (data: any) => {
            if (geminiService) {
                const time = new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
                geminiService.sendTextMessage(`[TIME: ${time}]`);
            }
        },
        interval: 60, // Every minute
        intervalInstance: null
    }

};

interface CommandConfig {
    shouldSpeak: () => string | false;
    color: string;
    transformText?: (text: string) => string;
    work?: (text: string) => void;
    unknown?: boolean;
}

export const commands: Record<string, CommandConfig> = {
    'SAY': {
        shouldSpeak: () => settings.TTS_FOR === "SAY" ? 'say' : false,
        color: 'green'
    },
    'WHISPER': {
        shouldSpeak: () => settings.TTS_FOR === "WHISPER" ? 'whisper' : false,
        transformText: (text) => "Бажання. " + text, // "Wish. " [content]
        color: 'green'
    },
    'THINK': {
        shouldSpeak: () => settings.TTS_FOR === "THINK" ? 'think' : false,
        color: 'blue'
    },
    'EMOTION': {
        shouldSpeak: () => false,
        color: 'magenta'
    },
    'PONG': {
        shouldSpeak: () => false,
        color: 'magenta'
    },
    'CONTEXT': {
        shouldSpeak: () => false,
        color: 'white',
        work: (text: string) => {
            // Check for duplicates in context.txt
            /*try {
                if (fs.existsSync('./context.txt')) {
                    const existingContent = fs.readFileSync('./context.txt', 'utf-8');
                    const lines = existingContent.split('\n');
                    // Check if *any* line contains the exact text after the timestamp
                    // Line format: [HH:mm:ss] text matches
                    // We check if the text exists in the file to prevent the model 
                    // from successfully dumping the entire history repeatedly.
                    const isDuplicate = lines.some(line => {
                        // Match "[timestamp] content"
                        const match = line.match(/^\[.*?\]\s+(.*)$/);
                        return match && match[1].trim() === text.trim();
                    });

                    if (isDuplicate) {
                        return;
                    }
                }
            } catch (e) {
                console.error("Error checking context duplicates:", e);
            }*/

            // Append with System Time
            const time = new Date().toLocaleTimeString('uk-UA'); // HH:mm:ss
            const logLine = `[${time}] ${text}\n`;

            //console.log(global.color('red','[SAVE TEXT]\t'), text);
            fs.appendFile('./context.txt', logLine, (err) => {
                if (err) console.error(err);
            });
            
            if(geminiService?.restartStage === 1){
                geminiService.restartStage = 2;
            }
        }
    }
};

interface KeyboardConfig {
    press: () => void;
    release: () => void;
}

export const keyboardActions: Record<string, KeyboardConfig> = {
    "BOTTOM": {
        press: () => {
            if (audioService) audioService.isGeminiAudioActive = true;
        },
        release: () => {
            if (audioService) audioService.isGeminiAudioActive = false;
        }
    },
    "TOP": {
        press: () => {
            if (geminiService) geminiService.sendTextMessage("[OWNER_START]");
        },
        release: () => {
            if (geminiService) geminiService.sendTextMessage("[OWNER_STOP]");
        }
    },
    "A": {
        press: () => {},
        release: () => {}
    },
    "B": {
        press: () => {},
        release: () => {}
    },
    "C": {
        press: () => {},
        release: () => {}
    },
    "D": {
        press: () => {},
        release: () => {}
    }
}

//////////////////////////////////

export function getCommandConfig(type: string): CommandConfig {
    return commands[type.toUpperCase()] || {
        shouldSpeak: () => false,
        transformText: (t) => t,
        color: 'gray',
        unknown: true
    };
}
export function getService(type: string): ServicesConfig {
    return services[type];
}

export function serviceStart(type: string): boolean {
    const service: ServicesConfig = services[type];
    if (!service) return false;
    console.log(global.color('green','[Service]\t'),"Starting service: "+global.color('cyan',type));
    if (!service.interval) {
      service.work(null);
      return true;
    }
    service.intervalInstance = setInterval(() => {
        service.work(null);
    }, service.interval*1000);
    return true;
}

export function serviceStop(type: string): boolean {
    const service: ServicesConfig = services[type];
    if (!service) return false;
    console.log(global.color('green','[Service]\t'),"Stop service: "+global.color('cyan',type));
    if (service.intervalInstance) {
        clearInterval(service.intervalInstance);
        service.intervalInstance = null;
    }
    return true;
}