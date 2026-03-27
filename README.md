# Quiz

# AI Quiz Solver – Chrome Extension (Ollama)

A production-grade Chrome Extension that **automatically solves quiz questions** using a **local Ollama AI** (llama3 / mistral).  
No cloud APIs. Everything runs on your machine.

---

## Features

| Feature | Description |
|---|---|
| 🧠 Smart Detection | Detects quiz questions automatically on page load via `MutationObserver` |
| 📖 DOM Priority | Reads question + choices directly from the DOM (fastest, < 1 s) |
| 📸 OCR Fallback | Falls back to Tesseract.js OCR if DOM text is unavailable (< 3 s) |
| 🤖 Local AI | Uses Ollama (`llama3` by default) via `POST http://localhost:11434/api/generate` |
| 🕵️ Stealth Mode | Clicks via `dispatchEvent`, random 100–300 ms delays, scroll-before-click |
| 🔄 Auto-Next | Detects and clicks Next/Continue button automatically |
| 🌍 Multi-Language | Works with Vietnamese and English quiz pages |
| ⚡ Performance | Async queue, duplicate guard, Q&A in-memory cache |
| 🛡 Anti-Detection | Random delays, human-like mouse event simulation |

---

## File Structure

```
manifest.json      – Manifest V3 extension config
background.js      – Service worker: Ollama API calls (2 s timeout, 1 retry)
content.js         – Content script: detection, extraction, answering, auto-next
utils.js           – Text normalization, fuzzy matching, Q&A cache
popup.html         – Popup UI: ON/OFF toggle + status
popup.js           – Popup logic
icons/             – Extension icons (16×16, 48×48, 128×128)
```

---

## Prerequisites

1. **Google Chrome** (or Chromium-based browser)
2. **Ollama** installed and running locally:
   ```bash
   # Install Ollama: https://ollama.com
   ollama serve          # starts the API on http://localhost:11434
   ollama pull llama3    # download the model (or: ollama pull mistral)
   ```

---

## Installation

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer Mode** (top-right toggle).
4. Click **Load unpacked** and select this repository folder.
5. The extension icon (🤖) will appear in your toolbar.

---

## Usage

1. Make sure **Ollama is running** (`ollama serve`).
2. Navigate to any quiz page.
3. The extension will automatically detect questions and answer them.
4. Click the extension icon to:
   - **Toggle ON/OFF** the auto-solver
   - See the **current status** (Active / Paused / Processing)
   - **Force a solve** with "⚡ Solve Now"
   - **Clear the Q&A cache** with "🗑 Clear Cache"

---

## Configuration

Edit `background.js` to change the AI model or timeout:

```js
const OLLAMA_MODEL = 'llama3';   // or 'mistral', 'phi3', etc.
const TIMEOUT_MS   = 2000;       // 2-second timeout per AI request
const MAX_RETRIES  = 1;          // retry once on failure
```

---

## Matching Logic

The extension uses a multi-stage matching strategy:

1. **Letter index** – if AI returns `A`, `B`, `C`, or `D`
2. **Exact normalized match** – lowercase, punctuation stripped
3. **Includes match** – AI answer is contained in a choice or vice-versa
4. **Fuzzy similarity** – word-overlap score ≥ 0.3
5. **Fallback** – longest / most detailed option

---

## Fallback Strategy

If the AI is unavailable or times out:
- Picks the **longest answer choice** (usually the most detailed / correct option)

---

## Debug Mode

Open Chrome DevTools on the quiz page (`F12` → Console) to see:
```
[QuizSolver] DOM question detected: Which of the following ...
[QuizSolver] DOM choices: ['Paris', 'London', 'Berlin', 'Madrid']
[QuizSolver] AI answer: A
[QuizSolver] Matched by letter index: A -> Paris
[QuizSolver] Clicking answer: Paris
[QuizSolver] Next button clicked.
```

---

## Privacy & Security

- **No data leaves your machine.** All AI inference runs locally via Ollama.
- No cloud APIs, no telemetry, no external network calls (except loading Tesseract.js from CDN on first OCR use).
