import { config } from 'dotenv';

config();

const settings = {
    PORT: process.env.PORT || 5000,
    API_KEY: process.env.GEMINI_API_KEY || '',
    VIDEO_DEVICE: process.env.CAMERA_NAME+'',
    AUDIO_DEVICE: process.env.MIC_NAME+'',
    WEBSOCKET_URL: process.env.GEMINI_WEBSOCKET_URL,
    FPS: 2, // Target FPS for processing/sending
    CAMERA_FPS: 30, // Hardware capture FPS
    CAMERA_WIDTH: 640,
    CAMERA_HEIGHT: 480,
    TTS_FOR: "SAY",
    ENABLE_CLIENT_MIC_MONITORING: false, 
    USE_VOICE_CHANGER: true,
    SOX_PARAMS: "pitch -50 echo 0.8 0.8 60 0.4 reverb 10 100 speed [s]",
    DELIM: "\n\nНижче буде твоя історія попередніх взаємодій з оточуючим світом. Використовуй цю інформацію, щоб надати більш контекстуальні відповіді.\n\n",
    MAX_TOKENS: 900000,
};

export default settings; 