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
    CAMERA_HEIGHT: 480
};

export default settings; 