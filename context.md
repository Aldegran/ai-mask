# Context: Project "AI Mask" (Кибер мозг)

## 1. Project Overview
Разработка носимой системы для LARP в сеттинге киберпанка.
**Архитектура:** Cloud-Native (Node.js + Google Gemini Multimodal Live API).
**Цель:** Игрок ("Оператор") носит шлем ("Маска"), через который ИИ ("Мозг") воспринимает мир и дает указания, а также общается с окружающими.

## 2. Terminology & Roles
* **Кибер мозг (AI Mask):** Название всего проекта.
* **Маска (Mask):** Аппаратная часть (Raspberry Pi 5, камера, микрофон, динамики, экран, перчатка). В прототипе эмулируется на Windows PC.
* **Мозг (Brain):** Облачный ИИ (Gemini 2.0 Flash), который видит/слышит через Маску и принимает решения.
* **Оператор (Operator):** Игрок-человек. Выполняет физические действия, но следует директивам Мозга.

## 3. Tech Stack
* **Runtime:** Node.js (TypeScript).
* **AI API:** Google Gemini Multimodal Live API (WebSocket).
* **Media Processing:** FFmpeg (захват A/V) + **SoX** (Real-time Voice Changer & Effects).
* **TTS:** Local Piper TTS (RAW PCM Stream -> SoX) — минимальная задержка.
* **State Management:** Local state (JSON/Redis) for context persistence between reconnections.

## 4. Hardware Configuration (Target)
* **Compute:** Raspberry Pi 5 (Active Cooler).
* **Vision:** Raspberry Pi Camera Module 3 (Wide).
* **Audio In:** USB Lavalier Mic (Maono).
* **Audio Out:** Bone Conduction Headphones (output via FFmpeg filter).
* **Visual Output:** 12x48 LED Matrix (Eyes) — displays emotions.
* **Controls:** Glove with buttons (PTT, PTV, Meta).

## 5. Key Functionality
1.  **PTT (Push-to-Talk):** Stream audio+video. AI responds with Audio + JSON.
2.  **PTV (Push-to-Vision):** Stream video ONLY. AI updates context silently.
3.  **Meta-Channel:** Оператор шепчет Мозгу контекст (через отдельную кнопку). Это системный ввод, не слышимый для игры.
4.  **Emotions:** ИИ присылает JSON `{"emotion": "ANGRY"}`, Маска выводит картинку на экран.
5.  **Voice Changer:** Весь звук (TTS, проигрывание файлов) проходит через **SoX Pipeline**.
    * Эффекты: Pitch shift, Speed correction, Reverb, Overdrive.
    * Поток: Piper (RAW S16LE) -> Pipe -> SoX (Effects) -> Speaker/Web.
6.  **Fail-safe & Watchdogs:** Авто-реконнект к Gemini при разрывах, тайм-аут на сохранение контекста.

## 6. Language
Весь игровой диалог — **Украинский**.
Системные промпты — настраиваются, но ожидают украинский ввод/вывод.