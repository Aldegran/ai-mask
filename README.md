# Проект "Кибер Мозг" (AI Mask)

Система ассистирования для киберпанк-LARP на базе Google Gemini и Raspberry Pi 4b.

## 🛠 Установка софта (Windows Dev)

1.  **Node.js**: Установи v20+ LTS [nodejs.org](https://nodejs.org/).
2.  **FFmpeg**:
    * Скачай билд (full) с [gyan.dev](https://www.gyan.dev/ffmpeg/builds/).
    * Распакуй и добавь папку `bin` в системную переменную `PATH`.
    * Проверка: `ffmpeg -version` в терминале.
3.  **SoX (Sound eXchange)**:
    * Скачай Windows бинарники с [SourceForge](https://sourceforge.net/projects/sox/files/sox/).
    * Распакуй содержимое (все файлы) в папку `server/tools/sox/`.
    * Проверка: файл `server/tools/sox/sox.exe` должен существовать.
4.  **Piper TTS**:
    * Скачай бинарник Piper для Windows.
    * Скачай модель голоса `uk_UA` (украинский).
    * Положи в папку `server/tools/piper`.
    * (Модель подключена как `uk_UA-ukrainian_tts-medium.onnx`).
5.  **API Key**:
    * Получи ключ в [Google AI Studio](https://aistudio.google.com/).
    * Создай файл `.env`: `GEMINI_API_KEY=твой_ключ`.

## 📦 Железо (Финальная сборка "Маска")

Для переноса прототипа потребуется:
* **SBC**: Raspberry Pi 4b (4GB/8GB).
* **Cooling**: Official Active Cooler (критично!).
* **Power**: Power Bank с поддержкой PD (минимум 3A/5V, лучше 20W+).
* **Vision**: Raspberry Pi Camera Module 3 Wide.
* **Sound In**: Maono AU-UL10 USB Lavalier Mic.
* **Sound Out**: Наушники костной проводимости (Bone Conduction).
* **Display**: LED Matrix 12x48 (гибкая, для глаз на шлеме).
* **Input**: Тактильные кнопки + 3D-печатная перчатка.
* **Helmet**: Кастомный шлем в стиле Cyberpunk (см. референс `image_4ea345.jpg`) — розовые/черные тона, уши-антенны.

## 🚀 Запуск прототипа

1.  `npm install`
2.  `npm start`
3.  **Управление:**
    * `Space` (Удерживать) — Говорить с Мозгом.
    * `V` (Удерживать) — Показать картинку (без звука).
    * `M` (Удерживать) — Шепот оператора (мета-инфо).