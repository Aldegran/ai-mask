import express from "express";
import http from 'http';
import WebSocket, { Server } from 'ws';
import GeminiService from './services/gemini.service';
import { AudioService } from './services/audio.service';
import { VideoService } from './services/video.service';
import cors from "cors";
import dotenv from "dotenv";
import settings from "./config/index";
import ffmpeg from 'fluent-ffmpeg';
import { spawn } from 'child_process';

dotenv.config();

// Initialize FFMPEG path
if (process.env.FFMPEG_PATH) {
    ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
}

const app = express();
const server = http.createServer(app);
const wss = new Server({ server });

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('AI Mask Prototype Server is running. Go to <a href="/video">/video</a> to see the stream.');
});

app.get('/video', (req, res) => {
    console.log('Starting video stream...');
    res.contentType('video/webm');

    const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

    const args = [
        '-f', 'dshow', 
        '-rtbufsize', '100M', 
        '-i', settings.VIDEO_DEVICE,
        '-f', 'dshow', 
        '-rtbufsize', '100M', 
        '-i', settings.AUDIO_DEVICE,
        '-c:v', 'libvpx',
        '-b:v', '1M',
        '-c:a', 'libvorbis',
        '-f', 'webm',
        '-deadline', 'realtime',
        '-cpu-used', '4',
        '-bufsize', '1000k',
        'pipe:1'
    ];

    console.log(`Spawning ${ffmpegPath} ${args.join(' ')}`);

    const proc = spawn(ffmpegPath, args);

    proc.stdout.pipe(res);

    proc.stderr.on('data', (data) => {
        console.error('FFmpeg stderr:', data.toString());
    });

    proc.on('close', (code) => {
        console.log(`FFmpeg process exited with code ${code}`);
    });

    req.on('close', () => {
        console.log('Client closed connection, killing ffmpeg...');
        proc.kill('SIGKILL');
    });
});

wss.on('connection', (ws: WebSocket) => {
    console.log('Client connected to WebSocket');
    const geminiService = new GeminiService(ws);
    const audioService = new AudioService(ws);
    const videoService = new VideoService(ws);
});

const PORT = settings.PORT || 5000;

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});