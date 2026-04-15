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

### 2.3. WebSocket Interaction (LLM API)
Осуществляется поддержка двух режимов через конфигурацию `.env` (`LLM=gemini` или `LLM=gpt`):
**Для Gemini (gemini.service.ts):**
* Адрес: `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent`
* Формат: Передача `setup` с системным промптом и `response_modalities` (AUDIO + TEXT). Прямой стриминг `realtime_input` (медиа чанки base64).

**Для OpenAI ChatGPT (gpt.service.ts):**
* Модель: `gpt-4o-realtime` (Realtime WebSocket API).
* Адрес: `wss://api.openai.com/v1/realtime?model=gpt-4o-realtime`
* Формат: Передача `session.update`, стриминг аудио через `input_audio_buffer.append`. Адаптировано игнорирование или отправка видео фреймов, так как нативная поддержка видео в WS Realtime пока отличается от Gemini.

* Keep-Alive: Реализовать пинг-понг (передача аудио тишины или `ping.wav`).
* Context Handling: При старте сессии загружать фиктивный "предыдущий контекст" из JSON файла (эмуляция памяти).

### 2.4. Output Handling
* **JSON Parsing:** Парсить текстовый канал от Gemini. Искать поле `emotion`.
* **Visualization (Web UI):** Отображение текущей эмоции и логов в веб-интерфейсе.

### 2.5. Интеграция LED Матрицы (WS2812B 16x32)
* **Драйвер матрицы:** Отдельный Python-скрипт (`display.py`), использующий библиотеку `neopixel` для аппаратного управления светодиодами (RPi GPIO 18, требуется `sudo`).
* **Бинарный протокол (IPC):** Node.js передает данные в Python через `stdin` в бинарном формате для максимальной скорости.
    * Команда `D` + 512 байт: Отрисовка кадра (индексы цветов).
    * Команда `C`: Очистка матрицы.
    * Команды `L` / `N`: Включение/выключение режима "Лампа" (аппаратный overlay).
* **Конвертация графики:** Встроенный обработчик загрузки BMP (форматы 16x32, либо 32x16 с автоматическим поворотом по часовой стрелке). Изображение конвертируется в кастомную 256-цветную палитру и сохраняется в бинарные `.hex` файлы.
* **Маппинг эмоций:** При получении эмоции от Gemini, система ищет соответствующий файл (например, `angry.hex`). Если файла нет, используется фоллбек (заливка цветом).
* **Режим "Лампа":** Наложение прозрачной маски (`lamp.hex`) поверх основного изображения. Чёрный цвет (0,0,0) считается прозрачным.

## 3. Code Structure Constraints
* Модульность: Вынести логику аудио, видео, сокетов и экрана в отдельные классы.
* Конфиг: Все настройки (API Key, Device IDs) в `.env` и общем конфиге.
* Error Handling: Авто-реконнект при разрыве сокета. Слежение за дочерними процессами (Python, Piper).

## 4. Deliverables
* `index.ts` (Main entry point / Web Server)
* `services/gemini.service.ts`
* `services/gpt.service.ts`
* `services/audio.service.ts`
* `services/video.service.ts`
* `services/display.service.ts` (Управление LED матрицей)
* `tools/display/display.py` (Аппаратный драйвер Python)