import GlobalThis from '../global';
declare const global: GlobalThis;
import settings from "./index";
import type { GeminiService } from '../services/gemini.service';
import fs from 'fs';

let geminiService: GeminiService | null = null;

export function setGeminiInstance(instance: GeminiService) {
    geminiService = instance;
}

interface ServicesConfig {
    work: (data: any) => any;
    interval: number;
    intervelInstance: NodeJS.Timeout | null;
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
        intervelInstance: null
    },
    'start': {
        work: (data: any) => {
            //if (geminiService) geminiService.sendTextMessage("[CONTEXT]");
        },
        interval: 0,
        intervelInstance: null
    },
    'contextUpdater': {
        work: (data: any) => {
            if (!geminiService) return;
            geminiService.sendTextMessage("[CONTEXT]");
        },
        interval: 10000,
        intervelInstance: null
    },

};

interface CommandConfig {
    shouldSpeak: () => boolean;
    color: string;
    transformText?: (text: string) => string;
    work?: (text: string) => void;
    unknown?: boolean;
}

export const commands: Record<string, CommandConfig> = {
    'SAY': {
        shouldSpeak: () => settings.TTS_FOR === "SAY",
        color: 'green'
    },
    'WHISPER': {
        shouldSpeak: () => settings.TTS_FOR === "WHISPER",
        transformText: (text) => "Бажання. " + text, // "Wish. " [content]
        color: 'green'
    },
    'THINK': {
        shouldSpeak: () => settings.TTS_FOR === "THINK",
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
            //console.log(global.color('red','[SAVE TEXT]\t'), text);
          fs.appendFile('./context.txt', text + '\n', (err) => {
            if (err) console.error(err);
          });
        }
    }
};

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
    console.log(global.color('green','[Service]\t'),`Starting service: "${type}"`);
    if (!service.interval) {
      service.work(null);
      return true;
    }
    service.intervelInstance = setInterval(() => {
        service.work(null);
    }, service.interval);
    return true;
}

export function serviceStop(type: string): boolean {
    const service: ServicesConfig = services[type];
    if (!service) return false;
    console.log(global.color('green','[Service]\t'),`Stop service: "${type}"`);
    if (service.intervelInstance) {
        clearInterval(service.intervelInstance);
        service.intervelInstance = null;
    }
    return true;
}