# Technical Task: AI Mask Windows Prototype

Необходимо создать Node.js (TypeScript) приложение для эмуляции работы шлема "Маска" на Windows машине перед переносом на Raspberry Pi.

## 1. Environment Setup
* Использовать `ws` для WebSocket соединения с Gemini.
* Использовать `fluent-ffmpeg` для захвата видео (VideoService).
* Использовать `child_process (spawn)` для управления **Piper** и **SoX**.
* Использовать `node-record-lpcm16` для захвата микрофона.
* Использовать `keypress` или `readline` для эмуляции кнопок (или Web UI Controls).

## 2. Functional Requirements

### 2.1. System Input (Keyboard Emulation)
Вместо GPIO использовать клавиши клавиатуры:
* `SPACE` (Hold): **PTT** (Стриминг Аудио + Видео).
* `V` (Hold): **PTV** (Стриминг только Видео кадров).
* `M` (Hold): **Meta** (Стриминг Аудио с префиксом "System Message" для LLM).
* `F` (Toggle): **Failsafe** (Прямой проброс микрофона в динамики через Voice Changer).

### 2.2. Media Pipeline (FFmpeg)
1.  **Video Input:** Захват с веб-камеры (используй `dshow` для Windows).
    * Format: JPEG frames, ~1 FPS (resize to 640x480).
    * Encoding: Base64 strings -> WebSocket.
2.  **Audio Input:** Захват с микрофона.
    * Format: Linear PCM 16kHz -> Base64 -> WebSocket.
3.  **Audio Output:**
    * Получение PCM аудио от Gemini -> Воспроизведение.
    * Интеграция локального **Piper TTS**: Если LLM присылает текст -> генерировать RAW PCM поток.
    * **Voice Changer Effect (SoX):**
        * Пайплайн: `TTS Output (Raw)` -> `SoX (Effects)` -> `Speaker (Server)` / `WAV (Web)`.
        * Поддержка параметров: `pitch`, `speed` (инверсия length_scale), `echo`, `reverb`, `overdrive`.

### 2.3. WebSocket Interaction (Gemini API)
* Адрес: `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent`
* Handshake: Передача `setup` сообщения с системным промптом (см. context.md) и определением `response_modalities` (AUDIO + TEXT).
* Keep-Alive: Реализовать пинг-понг или отправку пустых фреймов, чтобы соединение не рвалось.
* Context Handling: При старте сессии загружать фиктивный "предыдущий контекст" из JSON файла (эмуляция памяти).

### 2.4. Output Handling
* **JSON Parsing:** Парсить текстовый канал от Gemini. Искать поле `emotion`.
* **Visualization:** В консоль выводить ASCII-арт или текст текущей эмоции (вместо реального LED экрана): `[DISPLAY]: HAPPY`.

## 3. Code Structure Constraints
* Модульность: Вынести логику аудио, видео и сокетов в отдельные классы.
* Конфиг: Все настройки (API Key, Device IDs) в `.env`.
* Error Handling: Авто-реконнект при разрыве сокета.

## 4. Deliverables
* `index.ts` (Main entry point)
* `services/gemini.service.ts`
* `services/audio.service.ts`
* `services/video.service.ts`
* `utils/led-emulator.ts`