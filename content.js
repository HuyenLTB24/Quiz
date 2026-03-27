/**
 * content.js
 * Main content script for the AI Quiz Solver Chrome Extension.
 *
 * Responsibilities:
 * - Smart detection of quiz questions via MutationObserver
 * - Hybrid input: DOM text first, Tesseract.js OCR as fallback
 * - Send question to background.js (Ollama AI)
 * - Auto-answer with stealth mode (dispatchEvent + random delays)
 * - Auto-next: detect and click Next/Continue button
 * - Anti-detection: random delays, scroll before click, human-like timing
 * - Debug logging
 * - Multi-language support (Vietnamese + English)
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const DEBUG = true;

/** Minimum/maximum character length of a valid question text */
const MIN_QUESTION_LENGTH = 10;
const MAX_QUESTION_LENGTH = 2000;

/** Minimum/maximum character length of a valid choice text */
const MIN_CHOICE_LENGTH = 1;
const MAX_CHOICE_LENGTH = 500;

/** OCR language codes (Tesseract.js format) */
const OCR_LANGUAGES = 'eng+vie';

/** Selectors that commonly wrap quiz questions */
const QUESTION_SELECTORS = [
  '[class*="question"]',
  '[class*="Question"]',
  '[class*="quiz"]',
  '[class*="Quiz"]',
  '[id*="question"]',
  '[id*="Question"]',
  '[data-testid*="question"]',
  '.q-text',
  '.question-text',
  '.stem',
  'h1', 'h2', 'h3'
];

/** Selectors for answer choices */
const CHOICE_SELECTORS = [
  '[class*="answer"]',
  '[class*="Answer"]',
  '[class*="choice"]',
  '[class*="Choice"]',
  '[class*="option"]',
  '[class*="Option"]',
  '[data-testid*="answer"]',
  '[data-testid*="choice"]',
  '[data-testid*="option"]',
  'input[type="radio"]',
  'input[type="checkbox"]',
  'li'
];

/** Selectors for Next/Continue buttons */
const NEXT_BUTTON_SELECTORS = [
  'button[class*="next"]',
  'button[class*="Next"]',
  'button[class*="continue"]',
  'button[class*="Continue"]',
  'a[class*="next"]',
  'a[class*="continue"]',
  '[data-testid*="next"]',
  '[data-testid*="continue"]'
];

/** Next button text patterns (case-insensitive, multi-language) */
const NEXT_BUTTON_TEXT_PATTERNS = [
  /\bnext\b/i,
  /\bcontinue\b/i,
  /\btiếp\b/i,       // Vietnamese
  /\btiếp theo\b/i,
  /\bsau\b/i,
  /\bforward\b/i,
  /\bsubmit\b/i
];

// ─── State ───────────────────────────────────────────────────────────────────

let isEnabled = true;           // Can be toggled via popup
let isProcessing = false;       // Prevent concurrent processing
let lastQuestionText = '';      // Track last seen question to avoid duplicates
let processingQueue = [];       // Async processing queue

// ─── Logging ─────────────────────────────────────────────────────────────────

function log(...args) {
  if (DEBUG) console.log('[QuizSolver]', ...args);
}

function warn(...args) {
  if (DEBUG) console.warn('[QuizSolver]', ...args);
}

// ─── DOM Question Detection ───────────────────────────────────────────────────

/**
 * Attempt to extract the question text from the DOM.
 * Returns the best candidate element and its text.
 * @returns {{ element: Element, text: string } | null}
 */
function detectQuestionFromDOM() {
  for (const selector of QUESTION_SELECTORS) {
    const elements = Array.from(document.querySelectorAll(selector));
    for (const el of elements) {
      const text = (el.innerText || el.textContent || '').trim();
      if (text.length > MIN_QUESTION_LENGTH && text.length < MAX_QUESTION_LENGTH) {
        // Basic heuristic: contains a question-like structure
        if (text.includes('?') || /\b(which|what|who|where|when|how|why|choose|select|identify|câu|hỏi|chọn)\b/i.test(text)) {
          return { element: el, text };
        }
      }
    }
  }
  return null;
}

/**
 * Extract answer choice elements from the DOM.
 * Returns array of { text, element } objects.
 * @returns {{ text: string, element: Element }[]}
 */
function detectChoicesFromDOM() {
  const choices = [];

  // Try labeled choices first (A. B. C. D. or 1. 2. 3. 4.)
  for (const selector of CHOICE_SELECTORS) {
    const elements = Array.from(document.querySelectorAll(selector));
    if (elements.length >= 2) {
      for (const el of elements) {
        // For radio/checkbox inputs, look for the label text
        if (el.tagName === 'INPUT') {
          const label = el.closest('label') ||
                        document.querySelector(`label[for="${el.id}"]`) ||
                        el.parentElement;
          const text = label ? (label.innerText || label.textContent || '').trim() : '';
          if (text) choices.push({ text, element: el });
        } else {
          const text = (el.innerText || el.textContent || '').trim();
          if (text && text.length >= 1 && text.length < 500) {
            choices.push({ text, element: el });
          }
        }
      }
      if (choices.length >= 2) break;
    }
  }

  // Deduplicate by text
  const seen = new Set();
  return choices.filter(c => {
    const key = normalizeText(c.text);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── OCR Fallback ─────────────────────────────────────────────────────────────

/**
 * Capture a screenshot using chrome.tabs.captureVisibleTab via the background
 * service worker, then OCR it with Tesseract.js loaded dynamically.
 * This is a fallback when DOM text is unavailable.
 * @returns {Promise<string>}
 */
async function ocrFallback() {
  log('Attempting OCR fallback...');

  // Request screenshot from background
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'CAPTURE_SCREENSHOT' }, async (response) => {
      if (!response || !response.dataUrl) {
        warn('Screenshot capture failed');
        return resolve('');
      }

      try {
        // Dynamically load Tesseract.js from CDN if not already loaded
        if (typeof Tesseract === 'undefined') {
          await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
        }

        const result = await Tesseract.recognize(response.dataUrl, 'eng+vie', {
          logger: () => {}
        });
        resolve(result.data.text || '');
      } catch (err) {
        warn('OCR failed:', err.message);
        resolve('');
      }
    });
  });
}

/**
 * Dynamically inject a script tag.
 * @param {string} src
 * @returns {Promise<void>}
 */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// ─── AI Interaction ───────────────────────────────────────────────────────────

/**
 * Ask the background service worker to query Ollama.
 * @param {string} question
 * @param {string[]} choiceTexts
 * @returns {Promise<string>}
 */
function askAI(question, choiceTexts) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'SOLVE_QUESTION', payload: { question, choices: choiceTexts } },
      (response) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (response && response.success) {
          resolve(response.answer);
        } else {
          reject(new Error(response?.error || 'Unknown AI error'));
        }
      }
    );
  });
}

// ─── Stealth Click ────────────────────────────────────────────────────────────

/**
 * Click an element using dispatched events to mimic a real user.
 * Scrolls into view first, then waits a random delay.
 * @param {Element} element
 * @returns {Promise<void>}
 */
async function stealthClick(element) {
  // Scroll into view
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await sleep(randomInt(150, 350));

  // Simulate mouseover → mousedown → mouseup → click
  const events = ['mouseover', 'mouseenter', 'mousedown', 'mouseup', 'click'];
  for (const eventType of events) {
    const event = new MouseEvent(eventType, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: element.getBoundingClientRect().left + element.offsetWidth / 2,
      clientY: element.getBoundingClientRect().top + element.offsetHeight / 2
    });
    element.dispatchEvent(event);
    await sleep(randomInt(10, 30));
  }

  // Also change the value for radio/checkbox inputs
  if (element.tagName === 'INPUT' && (element.type === 'radio' || element.type === 'checkbox')) {
    element.checked = true;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

// ─── Next Button ─────────────────────────────────────────────────────────────

/**
 * Find and click the Next/Continue button.
 * @returns {Promise<boolean>} true if a button was found and clicked
 */
async function clickNextButton() {
  // Try selector-based approach first
  for (const selector of NEXT_BUTTON_SELECTORS) {
    const btn = document.querySelector(selector);
    if (btn && isVisible(btn)) {
      log('Found Next button via selector:', selector);
      await sleep(randomInt(400, 800));
      await stealthClick(btn);
      return true;
    }
  }

  // Fall back to text-based search
  const allButtons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
  for (const btn of allButtons) {
    const text = (btn.innerText || btn.textContent || '').trim();
    if (isVisible(btn) && NEXT_BUTTON_TEXT_PATTERNS.some(p => p.test(text))) {
      log('Found Next button via text:', text);
      await sleep(randomInt(400, 800));
      await stealthClick(btn);
      return true;
    }
  }

  return false;
}

/**
 * Check if an element is visible on screen.
 * @param {Element} el
 * @returns {boolean}
 */
function isVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

// ─── Main Processing Pipeline ─────────────────────────────────────────────────

/**
 * Main function: detect question → extract → AI → answer → next.
 */
async function processQuestion() {
  if (isProcessing || !isEnabled) return;
  isProcessing = true;

  try {
    // ── Step 1: Detect question (Priority: DOM) ──
    let questionText = '';
    let choices = [];

    const domQuestion = detectQuestionFromDOM();
    if (domQuestion) {
      questionText = domQuestion.text;
      choices = detectChoicesFromDOM();
      log('DOM question detected:', questionText);
      log('DOM choices:', choices.map(c => c.text));
    } else {
      // ── Fallback: OCR ──
      const ocrText = await ocrFallback();
      if (!ocrText || ocrText.trim().length < 10) {
        log('No question detected on page.');
        return;
      }
      questionText = ocrText;
      log('OCR text:', questionText);
    }

    // Skip if same question as last time (debounce)
    const normalizedQ = normalizeText(questionText);
    if (normalizedQ === lastQuestionText) {
      log('Duplicate question, skipping.');
      return;
    }
    lastQuestionText = normalizedQ;

    // ── Step 2: Check cache ──
    const cached = getCachedAnswer(questionText);
    let aiAnswer;
    if (cached) {
      log('Cache hit:', cached);
      aiAnswer = cached;
    } else {
      // ── Step 3: Ask AI ──
      const choiceTexts = choices.map(c => c.text);
      try {
        aiAnswer = await askAI(questionText, choiceTexts);
        log('AI answer:', aiAnswer);
        cacheAnswer(questionText, aiAnswer);
      } catch (err) {
        warn('AI failed, using fallback strategy:', err.message);
        // Fallback: pick longest / most detailed option
        if (choices.length) {
          const fallback = choices.reduce((a, b) => b.text.length > a.text.length ? b : a, choices[0]);
          aiAnswer = fallback.text;
          log('Fallback answer (longest):', aiAnswer);
        } else {
          log('No choices and AI failed. Giving up.');
          return;
        }
      }
    }

    // ── Step 4: Match and click ──
    if (choices.length) {
      const matched = matchAnswer(aiAnswer, choices);
      if (matched) {
        log('Clicking answer:', matched.text);
        await sleep(randomInt(100, 300));
        await stealthClick(matched.element);
      } else {
        warn('Could not match AI answer to any choice.');
      }
    }

    // ── Step 5: Auto-next ──
    await sleep(randomInt(500, 1000));
    const clicked = await clickNextButton();
    if (clicked) {
      log('Next button clicked. Waiting for next question...');
      lastQuestionText = ''; // Reset so next question is processed
    }

  } catch (err) {
    warn('Error in processQuestion:', err.message, err.stack);
  } finally {
    isProcessing = false;
  }
}

// ─── MutationObserver ─────────────────────────────────────────────────────────

let debounceTimer = null;

/**
 * Debounced trigger for question processing.
 */
function scheduleScan() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (isEnabled) processQuestion();
  }, 300);
}

// Observe DOM changes that may indicate a new question appeared
const observer = new MutationObserver((mutations) => {
  if (!isEnabled) return;

  const relevant = mutations.some(m =>
    m.addedNodes.length > 0 ||
    (m.type === 'attributes' && m.attributeName === 'class')
  );

  if (relevant) scheduleScan();
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['class', 'style']
});

// Initial scan on page load
scheduleScan();

// ─── Message Listener (from popup) ───────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'CLEAR_CACHE') {
    QA_CACHE.clear();
    lastQuestionText = '';
    log('Cache cleared.');
    sendResponse({ success: true });
  }

  if (message.type === 'SET_ENABLED') {
    isEnabled = message.payload.enabled;
    log('Extension', isEnabled ? 'enabled' : 'disabled');
    sendResponse({ success: true });
  }

  if (message.type === 'GET_STATUS') {
    sendResponse({ isEnabled, isProcessing, lastQuestion: lastQuestionText });
  }

  if (message.type === 'TRIGGER_NOW') {
    lastQuestionText = ''; // Force re-process
    processQuestion();
    sendResponse({ success: true });
  }
});
