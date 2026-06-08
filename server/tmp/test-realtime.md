# test-realtime.ts — Документация

Скрипт для тестирования realtime LLM моделей по трём критериям проекта:
1. WebSocket/realtime соединение
2. Приём аудио и видео фреймов
3. Ответ текстом (без аудио)

---

## Запуск

```bash
# из папки server/
npx ts-node tmp/test-realtime.ts <model-name> [options]
```

---

## Примеры

```bash
# Текущая GPT модель (используется в проекте)
npx ts-node tmp/test-realtime.ts gpt-realtime-1.5

# Gemini 3.1 Flash Live (native-audio, нужен воркэраунд для текста)
npx ts-node tmp/test-realtime.ts gemini-3.1-flash-live-preview

# Только текст, без медиа
npx ts-node tmp/test-realtime.ts gpt-realtime-1.5 --no-audio --no-video

# Только аудио, без видео и текста
npx ts-node tmp/test-realtime.ts gemini-3.1-flash-live-preview --no-video --no-text

# Увеличить таймаут (мс)
npx ts-node tmp/test-realtime.ts gpt-realtime-1.5 --timeout=30000
```

---

## Флаги

| Флаг | По умолчанию | Описание |
|------|-------------|----------|
| `--no-audio` | аудио включено | Не отправлять аудио чанк из `test.wav` |
| `--no-video` | видео включено | Не отправлять JPEG фрейм |
| `--no-text` | текст включён | Не отправлять текстовое сообщение |
| `--timeout=N` | 20000 | Максимальное время ожидания в мс |

---

## Поддерживаемые модели

Скрипт автоматически определяет провайдера по имени модели:

| Префикс | Провайдер | API ключ |
|---------|-----------|----------|
| `gemini-*` | Google Gemini Live API | `GEMINI_API_KEY` |
| `gpt-*` | OpenAI Realtime API | `OPEN_AI_API_KEY` |

Ключи читаются из `server/.env`.

---

## Как работает тест (логика)

Тест разбит на **две фазы** чтобы избежать конфликта между потоками:

**Фаза 1 — Текстовый I/O тест:**
Отправляется только текстовое сообщение, ждём ответ. Это подтверждает, что модель принимает текст и возвращает его обратно (или транскрипт — для Gemini native-audio). Аудио не отправляется, чтобы VAD (Voice Activity Detection) не "перехватил" очередь ответа.

**Фаза 2 — Медиа тест (после получения текстового ответа):**
Отправляется аудио чанк из `test.wav` (22050 Hz PCM16 mono) и минимальный 1×1 JPEG. Если ошибок нет — медиа принято. Соединение закрывается.

---

## Что проверяет тест

```
[✓] WebSocket connection       — Соединение установлено
[✓] Setup acknowledged         — Модель приняла конфиг (setup/session.update)
[✓] Audio chunk accepted       — Аудио отправлено без ошибок
[✓] Video frame accepted       — Видео фрейм отправлен без ошибок
[✓] Text response received     — Модель вернула текстовый ответ
[✓] Text received (transcript) — Для Gemini: транскрипт получен через outputAudioTranscription
[✓] Audio-only output          — Нет нежелательного аудио в ответе (для GPT)
• Connect latency              — Время установки соединения
• First response latency       — Время до первого токена ответа
```

---

## Особенности Gemini Live API (важно)

### Все текущие Gemini Live модели — native-audio

С **декабря 2025** Google убрал все non-native-audio модели Live API. Оставшиеся модели поддерживают **только AUDIO** как `response_modalities`. Текстовый ответ получается через воркэраунд:

```json
{
  "generationConfig": { "responseModalities": ["AUDIO"] },
  "outputAudioTranscription": {}
}
```

Модель отвечает аудио (PCM 24kHz) **и одновременно** шлёт текстовый транскрипт в `serverContent.outputTranscription.text`.

**Почему это не подходит для проекта:**
- Управляющие команды (`[SPEAK]`, `[EMOTION]`, и т.д.) завёрнуты в текст — транскрипт не гарантирует точное воспроизведение разметки
- Дополнительная нагрузка на сеть: модель генерирует аудио которое нам не нужно
- Дополнительная стоимость: $0.018/мин аудио-вывода который выбрасывается

**Статус:** Ждём, пока Google добавит поддержку `response_modalities: ["TEXT"]` для native-audio моделей.

### API версии

| Версия | Применение |
|--------|-----------|
| `v1alpha` | Старые модели (2.0-flash-exp-*) — сейчас недоступны |
| `v1beta` | Все актуальные модели (2.5+, 3.x) |

Скрипт автоматически выбирает версию по имени модели.

### Barge-in (прерывание)

Gemini native-audio поддерживает "barge-in": если в процессе генерации ответа приходит новый аудио-чанк, модель **прерывает** текущий ответ и начинает обрабатывать новый ввод. Именно поэтому в фазе 1 теста аудио не отправляется — иначе ответ на текстовое сообщение прерывается.

---

## Особенности GPT Realtime API

### Формат session.update

```json
{
  "type": "session.update",
  "session": {
    "type": "realtime",
    "output_modalities": ["text"],
    "instructions": "..."
  }
}
```

- `output_modalities: ["text"]` — только текст, без аудио ответа
- `type: "realtime"` — обязательное поле для этой версии API

### Видео

GPT Realtime API не поддерживает нативный стриминг видео. Фреймы передаются через `conversation.item.create` с типом `input_image`:

```json
{
  "type": "conversation.item.create",
  "item": {
    "type": "message",
    "role": "user",
    "content": [{ "type": "input_image", "image_url": "data:image/jpeg;base64,..." }]
  }
}
```

Это создаёт элемент в истории разговора, а не поток — фреймы "накапливаются" в контексте.

---

## Таблица сравнения моделей

| Модель | Контекст | Text In /1M | Text Out /1M | Audio In /мин | Video | TEXT output |
|--------|----------|-------------|--------------|---------------|-------|-------------|
| `gpt-realtime-1.5` **← текущий** | 32K | $4.00 | $16.00 | $0.048 | ~1 FPS* | ✅ прямой |
| `gemini-3.1-flash-live-preview` | 128K | $0.75 | $4.50 | $0.005 | 1 FPS нативный | ⚠️ только транскрипт |
| `gemini-live-2.5-flash-native-audio` | 128K | $0.30 | $4.50 | $0.005 | 1 FPS нативный | ⚠️ только транскрипт |

> \* GPT видео — не нативный стриминг, а `input_image` в conversation history

---

## Файлы

| Файл | Описание |
|------|----------|
| `server/tmp/test-realtime.ts` | Скрипт тестирования |
| `server/tmp/test-realtime.md` | Этот файл |
| `server/test.wav` | Тестовый аудио файл (22050 Hz, PCM16, mono) |
| `server/.env` | API ключи (GEMINI_API_KEY, OPEN_AI_API_KEY) |
