/**
 * Настройка параметров SoX (Sound eXchange) для изменения голоса:
 * 
 * sudo apt-get install sox libsox-fmt-all # Установка SoX на Ubuntu
 * 
 * SOX_PARAMS - строка аргументов эффектов, применяемых к аудио.
 * Основные эффекты:
 * - pitch [shift]: Сдвиг высоты тона (в полутонах * 100). Пример: 'pitch -300' (ниже на 3 полутона), 'pitch 400' (выше).
 * - echo [gain-in] [gain-out] [delay] [decay]: Эхо. Пример: 'echo 0.8 0.8 60 0.4' (роботизированное эхо).
 * - reverb [reverberance] [hf-damping] [room-scale] [stereo-depth] [pre-delay] [wet-gain]: Реверберация (эхо комнаты).
 * - bass/treble [gain] [frequency] [width]: Эквалайзер. Пример: 'bass +3 100 0.5' (усиление басов).
 * - overdrive [gain] [colour]: Дисторшн/перегруз. Пример: 'overdrive 20 20' (эффект рации).
 * 
 * Комбинации:
 * Робот: "pitch -300 speed 0.9 echo 0.8 0.8 60 0.4"
 * Демон: "pitch -600 bass +5 80 0.4 reverb 50 50 100"
 * Эльф: "pitch 400 treble +3"
 */
import { config } from 'dotenv';

config();

const settings = {
    IS_LINUX: process.platform === 'linux',
    PORT: process.env.PORT || 5000,
    API_KEY: process.env.GEMINI_API_KEY || '',
    VIDEO_DEVICE: process.env.CAMERA_NAME+'',
    AUDIO_DEVICE: process.env.MIC_NAME+'',
    WEBSOCKET_URL: process.env.GEMINI_WEBSOCKET_URL,
    FPS: 1, // Target FPS for processing/sending
    CAMERA_FPS: 30, // Hardware capture FPS
    CAMERA_WIDTH: 640,
    CAMERA_HEIGHT: 480,
    TTS_FOR: "SAY",
    ENABLE_CLIENT_MIC_MONITORING: false, 
    USE_VOICE_CHANGER: true,
    SOX_PARAMS: "pitch -50 echo 0.8 0.8 60 0.4 reverb 10 100 speed [s]",
    SOX_ECHO_PARAMS: "pitch 200 echo 0.8 0.8 60 0.4 reverb 10 100",
    DELIM: "\n\nНижче буде твоя історія попередніх взаємодій з оточуючим світом. Використовуй цю інформацію, щоб надати більш контекстуальні відповіді.\n\n",
    MAX_TOKENS: 900000,
};

export default settings; 