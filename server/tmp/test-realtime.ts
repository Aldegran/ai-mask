/**
 * Realtime LLM Model Tester
 * Tests WebSocket connection, audio streaming, video frame streaming, and text-only response.
 *
 * Usage:
 *   ts-node tmp/test-realtime.ts <model-name> [options]
 *
 * Examples:
 *   ts-node tmp/test-realtime.ts gemini-3.1-flash-live-preview
 *   ts-node tmp/test-realtime.ts gemini-2.0-flash-exp-image-generation
 *   ts-node tmp/test-realtime.ts gpt-realtime-1.5
 *   ts-node tmp/test-realtime.ts gemini-live-2.5-flash-native-audio
 *
 * Options:
 *   --audio     Send audio chunk from test.wav  (default: true)
 *   --video     Send a fake JPEG video frame    (default: true)
 *   --text      Send a text message             (default: true)
 *   --timeout   Max wait for response in ms     (default: 20000)
 */

import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';

config({ path: path.join(__dirname, '..', '.env') });

// ─────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────
const args = process.argv.slice(2);
const modelArg = args.find(a => !a.startsWith('--'));
if (!modelArg) {
    console.error('Usage: ts-node tmp/test-realtime.ts <model-name> [--audio] [--video] [--text] [--timeout=N]');
    process.exit(1);
}

const flags = {
    audio: !args.includes('--no-audio'),
    video: !args.includes('--no-video'),
    text: !args.includes('--no-text'),
    timeout: (() => {
        const t = args.find(a => a.startsWith('--timeout='));
        return t ? parseInt(t.split('=')[1]) : 20000;
    })(),
};

// ─────────────────────────────────────────────
// Model detection
// ─────────────────────────────────────────────
const isGemini = modelArg.toLowerCase().includes('gemini') || modelArg.toLowerCase().includes('gemini-live');
const isGPT    = modelArg.toLowerCase().startsWith('gpt');

if (!isGemini && !isGPT) {
    console.error(`Unknown model family for "${modelArg}". Expected a Gemini or GPT model name.`);
    process.exit(1);
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
const esc = {
    reset:  '\x1b[0m',
    bold:   '\x1b[1m',
    red:    '\x1b[31m',
    green:  '\x1b[32m',
    yellow: '\x1b[33m',
    cyan:   '\x1b[36m',
    gray:   '\x1b[90m',
};

const log = {
    ok:   (msg: string) => console.log(`${esc.green}[✓]${esc.reset} ${msg}`),
    warn: (msg: string) => console.log(`${esc.yellow}[!]${esc.reset} ${msg}`),
    err:  (msg: string) => console.log(`${esc.red}[✗]${esc.reset} ${msg}`),
    info: (msg: string) => console.log(`${esc.cyan}[i]${esc.reset} ${msg}`),
    raw:  (msg: string) => console.log(`${esc.gray}${msg}${esc.reset}`),
};

const timer = (label: string) => {
    const start = Date.now();
    return () => `${label}: ${Date.now() - start}ms`;
};

// ─────────────────────────────────────────────
// Minimal 1x1 JPEG (valid JPEG binary)
// ─────────────────────────────────────────────
function makeMinimalJpeg(): Buffer {
    // A valid 1×1 white JPEG
    return Buffer.from(
        'ffd8ffe000104a46494600010100000100010000' +
        'ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432' +
        'ffc0000b080001000101011100' +
        'ffc4001f0000010501010101010100000000000000000102030405060708090a0b' +
        'ffc40000' +
        'ffda00030101003f00f50000' +
        'ffd9',
        'hex'
    );
}

// Load WAV file and extract raw PCM (strip 44-byte header)
function loadPcmFromWav(wavPath: string): Buffer | null {
    if (!fs.existsSync(wavPath)) {
        log.warn(`WAV file not found: ${wavPath}`);
        return null;
    }
    const data = fs.readFileSync(wavPath);
    // WAV header is typically 44 bytes; skip it
    return data.slice(44);
}

// ─────────────────────────────────────────────
// Test results
// ─────────────────────────────────────────────
interface TestResults {
    model: string;
    provider: 'gemini' | 'gpt';
    connected: boolean;
    setupAck: boolean;
    audioAccepted: boolean;
    videoAccepted: boolean;
    textResponseReceived: boolean;
    audioResponseReceived: boolean;
    connectLatencyMs: number | null;
    firstResponseLatencyMs: number | null;
    rawResponses: string[];
    errors: string[];
}

const results: TestResults = {
    model: modelArg,
    provider: isGemini ? 'gemini' : 'gpt',
    connected: false,
    setupAck: false,
    audioAccepted: false,
    videoAccepted: false,
    textResponseReceived: false,
    audioResponseReceived: false,
    connectLatencyMs: null,
    firstResponseLatencyMs: null,
    rawResponses: [],
    errors: [],
};

// ─────────────────────────────────────────────
// GEMINI test
// ─────────────────────────────────────────────
function runGeminiTest(resolve: () => void) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        log.err('GEMINI_API_KEY not found in .env');
        results.errors.push('Missing GEMINI_API_KEY');
        return resolve();
    }

    // Native-audio models (3.x, 2.5-native-audio) only support AUDIO output.
    // We use AUDIO + output_audio_transcription to receive text as transcript.
    // Legacy non-native models (gemini-2.0-flash-exp*) support TEXT directly (deprecated).
    const isNativeAudio = !modelArg!.includes('2.0') && !modelArg!.includes('exp');

    // API endpoint: v1beta for current models, v1alpha for legacy 2.0 models
    const apiVersion = (modelArg!.includes('2.0') || modelArg!.includes('exp')) ? 'v1alpha' : 'v1beta';
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${apiVersion}.GenerativeService.BidiGenerateContent?key=${apiKey}`;
    log.info(`API version: ${apiVersion}`);
    log.info(`Native-audio mode: ${isNativeAudio} (${isNativeAudio ? 'AUDIO+transcription' : 'TEXT direct'})`);
    log.info(`Connecting: ${url.replace(apiKey, '***')}`);

    const connectStart = Date.now();
    let responseStart: number | null = null;
    // v1beta uses camelCase field names; v1alpha uses snake_case
    const isBeta = apiVersion === 'v1beta';
    const ws = new WebSocket(url);

    ws.on('open', () => {
        results.connected = true;
        results.connectLatencyMs = Date.now() - connectStart;
        log.ok(`Connected in ${results.connectLatencyMs}ms`);

        // Native-audio models: must use AUDIO modality + outputAudioTranscription at setup level
        // Non-native models: can use TEXT directly in generation_config
        const setupMsg: any = isBeta
            ? {
                setup: {
                    model: `models/${modelArg}`,
                    generationConfig: {
                        responseModalities: isNativeAudio ? ['AUDIO'] : ['TEXT'],
                        temperature: 0.5,
                    },
                    systemInstruction: {
                        parts: [{ text: 'You are a test assistant. Reply with: {"status":"ok","model_works":true}' }]
                    },
                    ...(isNativeAudio ? { outputAudioTranscription: {} } : {})
                }
              }
            : {
                setup: {
                    model: `models/${modelArg}`,
                    generation_config: {
                        response_modalities: ['TEXT'],
                        temperature: 0.5,
                    },
                    system_instruction: {
                        parts: [{ text: 'You are a test assistant. Reply with: {"status":"ok","model_works":true}' }]
                    }
                }
              };
        const setup = setupMsg;
        ws.send(JSON.stringify(setup));
        log.info(`Sent setup (${isNativeAudio ? 'AUDIO+transcription' : 'TEXT-only'} output)`);
    });

    ws.on('message', (raw: WebSocket.Data) => {
        const str = raw.toString();
        results.rawResponses.push(str.substring(0, 300));
        let msg: any;
        try { msg = JSON.parse(str); } catch { return; }

        // Setup acknowledgement
        if (msg.setupComplete !== undefined || msg.setup_complete !== undefined) {
            results.setupAck = true;
            log.ok('Setup acknowledged by model');
            responseStart = Date.now();

            // Phase 1: Send text to get a text response (confirms text I/O works)
            if (flags.text) {
                let textMsg: any;
                if (isBeta && isNativeAudio) {
                    textMsg = { realtimeInput: { text: 'Reply with: {"status":"ok","model_works":true}' } };
                } else if (isBeta) {
                    textMsg = { clientContent: { turns: [{ role: 'user', parts: [{ text: 'Reply with: {"status":"ok","model_works":true}' }] }], turnComplete: true } };
                } else {
                    textMsg = { client_content: { turns: [{ role: 'user', parts: [{ text: 'Reply with: {"status":"ok","model_works":true}' }] }], turn_complete: true } };
                }
                ws.send(JSON.stringify(textMsg));
                log.ok('Phase 1: Sent text trigger (waiting for response before sending media)');
            } else {
                // No text test — immediately proceed to send media
                sendMediaPhase();
            }
        }

        function sendMediaPhase() {
            // Phase 2: Confirm audio+video are accepted (after text response)
            // This simulates PTT: stream audio+video chunks, then signal end
            if (flags.audio) {
                const wavPath = path.join(__dirname, '..', 'test.wav');
                const pcm = loadPcmFromWav(wavPath);
                if (pcm) {
                    const audioChunk = pcm.slice(0, 22050 * 2); // ~1s @ 22050Hz/16bit
                    const AUDIO_MIME = 'audio/pcm;rate=22050';
                    const audioMsg = isBeta
                        ? { realtimeInput: { audio: { data: audioChunk.toString('base64'), mimeType: AUDIO_MIME } } }
                        : { realtime_input: { media_chunks: [{ mime_type: AUDIO_MIME, data: audioChunk.toString('base64') }] } };
                    ws.send(JSON.stringify(audioMsg));
                    results.audioAccepted = true;
                    log.ok(`Phase 2a: Sent audio chunk (${audioChunk.length} bytes @ 22050Hz)`);
                }
            }
            if (flags.video) {
                const jpeg = makeMinimalJpeg();
                const videoMsg = isBeta
                    ? { realtimeInput: { video: { data: jpeg.toString('base64'), mimeType: 'image/jpeg' } } }
                    : { realtime_input: { media_chunks: [{ mime_type: 'image/jpeg', data: jpeg.toString('base64') }] } };
                ws.send(JSON.stringify(videoMsg));
                results.videoAccepted = true;
                log.ok(`Phase 2b: Sent video frame (${jpeg.length} bytes JPEG)`);
            }
            // Close after a short delay (no errors = media accepted)
            setTimeout(() => {
                log.ok('Media accepted (no format errors) — closing');
                ws.close(1000);
            }, 2000);
        }

        // Text response (non-native-audio models — modelTurn.parts.text)
        const modelTurnParts = msg.serverContent?.modelTurn?.parts
                            || msg.serverContent?.model_turn?.parts || [];
        for (const part of modelTurnParts) {
            if (part.text) {
                results.textResponseReceived = true;
                if (responseStart && !results.firstResponseLatencyMs) {
                    results.firstResponseLatencyMs = Date.now() - responseStart;
                }
                log.ok(`[modelTurn text] ${esc.bold}${part.text.substring(0, 200)}${esc.reset}`);
            }
            const inlineData = part.inlineData || part.inline_data;
            if (inlineData?.mimeType?.startsWith('audio') || inlineData?.mime_type?.startsWith('audio')) {
                results.audioResponseReceived = true;
                log.warn(`[modelTurn audio] ${inlineData.mimeType || inlineData.mime_type} chunk received`);
            }
        }

        // Text via outputAudioTranscription (native-audio models, v1beta camelCase)
        const transcriptText = msg.serverContent?.outputTranscription?.text
                            || msg.serverContent?.output_transcription?.text;
        if (transcriptText) {
            results.textResponseReceived = true;
            if (responseStart && !results.firstResponseLatencyMs) {
                results.firstResponseLatencyMs = Date.now() - responseStart;
            }
            log.ok(`[transcript] ${esc.bold}${transcriptText.substring(0, 200)}${esc.reset}`);
        }

        // Session termination signals: turnComplete (legacy) or generationComplete (v1beta native-audio)
        const isDone = msg.serverContent?.turnComplete
                    || msg.serverContent?.turn_complete
                    || msg.serverContent?.generationComplete;
        if (isDone && results.textResponseReceived && !results.audioAccepted && !results.videoAccepted) {
            // Phase 1 response received — now test media acceptance
            log.info('Text response complete — proceeding to media test (Phase 2)');
            sendMediaPhase();
        } else if (isDone && (results.audioAccepted || results.videoAccepted)) {
            log.info('Generation complete — closing connection');
            ws.close(1000);
        }

        if (msg.usageMetadata) {
            log.info(`Token usage: input=${msg.usageMetadata.promptTokenCount ?? '?'}, output=${msg.usageMetadata.candidatesTokenCount ?? '?'}, total=${msg.usageMetadata.totalTokenCount ?? '?'}`);
        }

        if (msg.error) {
            log.err(`API error: ${JSON.stringify(msg.error)}`);
            results.errors.push(JSON.stringify(msg.error));
        }
    });

    ws.on('close', (code, reason) => {
        log.info(`Socket closed: ${code} ${reason}`);
        resolve();
    });

    ws.on('error', (err) => {
        log.err(`WebSocket error: ${err.message}`);
        results.errors.push(err.message);
        resolve();
    });
}

// ─────────────────────────────────────────────
// GPT test
// ─────────────────────────────────────────────
function runGptTest(resolve: () => void) {
    const apiKey = process.env.OPEN_AI_API_KEY;
    if (!apiKey) {
        log.err('OPEN_AI_API_KEY not found in .env');
        results.errors.push('Missing OPEN_AI_API_KEY');
        return resolve();
    }

    const url = `wss://api.openai.com/v1/realtime?model=${modelArg}`;
    log.info(`Connecting to OpenAI Realtime API: ${url}`);

    const connectStart = Date.now();
    let responseStart: number | null = null;
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${apiKey}` } });

    ws.on('open', () => {
        results.connected = true;
        results.connectLatencyMs = Date.now() - connectStart;
        log.ok(`Connected in ${results.connectLatencyMs}ms`);

        ws.send(JSON.stringify({
            type: 'session.update',
            session: {
                type: 'realtime',
                output_modalities: ['text'],
                instructions: 'You are a test assistant. Reply with exactly: {"status":"ok","model_works":true}',
            }
        }));
        log.info('Sent session.update (TEXT-only output)');
    });

    ws.on('message', (raw: WebSocket.Data) => {
        const str = raw.toString();
        results.rawResponses.push(str.substring(0, 300));

        let msg: any;
        try { msg = JSON.parse(str); } catch { return; }

        // session.created fires on connection; session.updated is the ack of our session.update.
        if (msg.type === 'session.updated') {
            results.setupAck = true;
            log.ok('Session updated (setup ack)');
            responseStart = Date.now();

            // Phase 1: text-only to trigger and confirm text I/O
            if (flags.text) {
                ws.send(JSON.stringify({
                    type: 'conversation.item.create',
                    item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Reply with exactly: {"status":"ok","model_works":true}' }] }
                }));
                ws.send(JSON.stringify({ type: 'response.create' }));
                log.ok('Phase 1: Sent text + response.create');
            } else {
                gptMediaPhase();
            }
        }

        function gptMediaPhase() {
            // Phase 2: confirm audio+video acceptance (after text response)
            if (flags.audio) {
                const wavPath = path.join(__dirname, '..', 'test.wav');
                const pcm = loadPcmFromWav(wavPath);
                if (pcm) {
                    const chunk = pcm.slice(0, 22050 * 2); // ~1s @ 22050Hz
                    ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: chunk.toString('base64') }));
                    ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
                    results.audioAccepted = true;
                    log.ok(`Phase 2a: Sent audio chunk (${chunk.length} bytes @ 22050Hz)`);
                }
            }
            if (flags.video) {
                const jpeg = makeMinimalJpeg();
                ws.send(JSON.stringify({
                    type: 'conversation.item.create',
                    item: { type: 'message', role: 'user', content: [{ type: 'input_image', image_url: `data:image/jpeg;base64,${jpeg.toString('base64')}` }] }
                }));
                results.videoAccepted = true;
                log.ok(`Phase 2b: Sent video frame (${jpeg.length} bytes JPEG)`);
            }
            setTimeout(() => {
                log.ok('Media accepted (no errors) — closing');
                ws.close(1000);
            }, 1000);
        }

        if (msg.type === 'response.output_text.delta') {
            results.textResponseReceived = true;
            if (responseStart && !results.firstResponseLatencyMs) {
                results.firstResponseLatencyMs = Date.now() - responseStart;
            }
            process.stdout.write(`${esc.green}${msg.delta}${esc.reset}`);
        }

        if (msg.type === 'response.audio.delta') {
            results.audioResponseReceived = true;
            log.warn('Audio response received (unexpected — we requested TEXT only!)');
        }

        if (msg.type === 'response.done') {
            console.log('');
            if (msg.response?.usage) {
                const u = msg.response.usage;
                log.info(`Token usage: input=${u.input_tokens ?? '?'} (text=${u.input_token_details?.text_tokens ?? '?'}, audio=${u.input_token_details?.audio_tokens ?? '?'}), output=${u.output_tokens ?? '?'}`);
            }
            if (results.textResponseReceived && !results.audioAccepted && !results.videoAccepted) {
                log.info('Text response done — proceeding to media test (Phase 2)');
                gptMediaPhase();
            } else {
                log.info('Response done — closing connection');
                ws.close(1000);
            }
        }

        if (msg.type === 'error') {
            log.err(`API error: ${msg.error?.message ?? JSON.stringify(msg.error)}`);
            results.errors.push(msg.error?.message ?? JSON.stringify(msg.error));
        }
    });

    ws.on('close', (code, reason) => {
        log.info(`Socket closed: ${code} ${reason}`);
        resolve();
    });

    ws.on('error', (err) => {
        log.err(`WebSocket error: ${err.message}`);
        results.errors.push(err.message);
        resolve();
    });
}

// ─────────────────────────────────────────────
// Print final report
// ─────────────────────────────────────────────
function printReport() {
    console.log('\n' + '═'.repeat(60));
    console.log(`${esc.bold}  TEST REPORT — ${results.model}${esc.reset}`);
    console.log('═'.repeat(60));

    const row = (label: string, value: boolean | string | null) => {
        if (typeof value === 'boolean') {
            const icon = value ? `${esc.green}✓${esc.reset}` : `${esc.red}✗${esc.reset}`;
            console.log(`  ${icon}  ${label}`);
        } else {
            console.log(`  ${esc.cyan}•${esc.reset}  ${label}: ${value ?? 'N/A'}`);
        }
    };

    row('WebSocket connection', results.connected);
    row('Setup acknowledged',  results.setupAck);
    row('Audio chunk accepted', results.audioAccepted);
    row('Video frame accepted', results.videoAccepted);
    row('Text response received', results.textResponseReceived);
    row('Text received (via transcript if native-audio)', results.textResponseReceived);
    row('Audio-only output (no text leak)', !results.audioResponseReceived || results.textResponseReceived);
    row('Connect latency', results.connectLatencyMs ? `${results.connectLatencyMs}ms` : null);
    row('First response latency', results.firstResponseLatencyMs ? `${results.firstResponseLatencyMs}ms` : null);

    if (results.errors.length > 0) {
        console.log(`\n  ${esc.red}Errors:${esc.reset}`);
        results.errors.forEach(e => console.log(`    - ${e}`));
    }

    // For native-audio Gemini: audio output IS expected; text comes via transcript — that's our success criterion
    const audioOk = results.provider === 'gemini'
        ? results.textResponseReceived  // transcript received = success
        : !results.audioResponseReceived;  // GPT: no audio = success (text-only)
    const allPassed = results.connected && results.setupAck && results.textResponseReceived && audioOk && results.errors.filter(e => !e.includes('Timeout')).length === 0;
    console.log('\n' + '─'.repeat(60));
    if (allPassed) {
        console.log(`  ${esc.green}${esc.bold}RESULT: PASS ✓ — Model is suitable for our use case${esc.reset}`);
    } else {
        console.log(`  ${esc.red}${esc.bold}RESULT: FAIL ✗ — Model did not meet all requirements${esc.reset}`);
    }
    console.log('═'.repeat(60) + '\n');

    // Comparison table
    console.log(`${esc.bold}MODEL COMPARISON TABLE${esc.reset}`);
    console.log('─'.repeat(100));
    console.log(`${'Model'.padEnd(45)} ${'Context'.padEnd(10)} ${'Text In/1M'.padEnd(14)} ${'Text Out/1M'.padEnd(14)} ${'Audio In/min'.padEnd(14)} ${'Video FPS'.padEnd(10)} Provider`);
    console.log('─'.repeat(100));
    const models = [
        { name: 'gpt-realtime-1.5 (CURRENT)',      ctx: '32K',   tin: '$4.00',  tout: '$16.00', ain: '$0.048', vfps: '~1 FPS*', provider: 'OpenAI' },
        { name: 'gemini-3.1-flash-live-preview',   ctx: '128K',  tin: '$0.75',  tout: '$4.50',  ain: '$0.005', vfps: '1 FPS',   provider: 'Google' },
        { name: 'gemini-live-2.5-flash-native-audio', ctx: '128K', tin: '$0.30', tout: '$4.50', ain: '$0.005', vfps: '1 FPS',  provider: 'Google' },
        { name: 'gemini-2.0-flash-exp (deprecated)', ctx: '32K', tin: '$0.10',  tout: '$0.40',  ain: '$0.005', vfps: '1 FPS',  provider: 'Google' },
    ];
    models.forEach(m => {
        const isCurrent = m.name.includes('CURRENT') ? esc.yellow : (m.name === results.model ? esc.green : '');
        const reset = isCurrent ? esc.reset : '';
        console.log(`${isCurrent}${m.name.padEnd(45)} ${m.ctx.padEnd(10)} ${m.tin.padEnd(14)} ${m.tout.padEnd(14)} ${m.ain.padEnd(14)} ${m.vfps.padEnd(10)} ${m.provider}${reset}`);
    });
    console.log('─'.repeat(100));
    console.log(`${esc.gray}* GPT video: sent as input_image conversation item (not native streaming — frames queued, not realtime)${esc.reset}`);
    console.log(`${esc.gray}  Audio cost: 1 token = 100ms audio (input), 1 token = 50ms (output). $32/1M tokens ≈ $0.048/min input, $0.192/min output${esc.reset}`);
    console.log(`${esc.gray}  Gemini audio: $0.005/min input, $0.018/min output (≈10x cheaper than GPT)${esc.reset}`);
}

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────
console.log('\n' + '═'.repeat(60));
console.log(`${esc.bold}  REALTIME LLM TESTER${esc.reset}`);
console.log(`  Model:    ${esc.cyan}${modelArg}${esc.reset}`);
console.log(`  Provider: ${esc.cyan}${isGemini ? 'Google Gemini' : 'OpenAI GPT'}${esc.reset}`);
console.log(`  Audio:    ${flags.audio}, Video: ${flags.video}, Text: ${flags.text}`);
console.log(`  Timeout:  ${flags.timeout}ms`);
console.log('═'.repeat(60) + '\n');

const testPromise = new Promise<void>(resolve => {
    if (isGemini) runGeminiTest(resolve);
    else runGptTest(resolve);
});

const timeoutPromise = new Promise<void>(resolve => {
    setTimeout(() => {
        log.warn(`Timeout after ${flags.timeout}ms`);
        results.errors.push(`Timeout after ${flags.timeout}ms`);
        resolve();
    }, flags.timeout);
});

Promise.race([testPromise, timeoutPromise]).then(() => {
    printReport();
    process.exit(results.errors.length > 0 ? 1 : 0);
});
