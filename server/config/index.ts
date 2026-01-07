import { config } from 'dotenv';

config();

/**
 * Application configuration settings.
 * 
 * @remarks
 * Configuration object containing essential settings for the application:
 * - `API_KEY`: Google AI API key for authentication. Should be set via environment variable.
 * - `DEVICE_ID`: Unique device identifier used for tracking and session management in Google AI API requests.
 *   This is typically a UUID or unique string that identifies the client device/session.
 *   Can be generated using `crypto.randomUUID()` or obtained from device registration.
 * - `WEBSOCKET_URL`: WebSocket endpoint URL for Google's Generative AI BidiGenerateContent service.
 * 
 * @example
 * ```typescript
 * // Set environment variables before importing
 * process.env.API_KEY = 'your-api-key';
 * process.env.DEVICE_ID = crypto.randomUUID();
 * ```
 */
const settings = {
    PORT: process.env.PORT || 5000,
    API_KEY: process.env.GEMINI_API_KEY || '',
    VIDEO_DEVICE: 'video=HD Pro Webcam C920',
    AUDIO_DEVICE: 'audio=Microphone (HD Pro Webcam C920)',
    WEBSOCKET_URL: 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent',
    FPS: 2, // Target FPS for processing/sending
    CAMERA_FPS: 30 // Hardware capture FPS
};

export default settings;