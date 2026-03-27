/**
 * background.js
 * Service worker for Chrome Extension (Manifest V3).
 * Handles communication with the local Ollama API.
 */

const OLLAMA_ENDPOINT = 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = 'llama3';
const TIMEOUT_MS = 5000;
const MAX_RETRIES = 1;

/**
 * Send a prompt to Ollama and return the response text.
 * Retries once on failure.
 * @param {string} prompt
 * @param {number} attempt
 * @returns {Promise<string>}
 */
async function queryOllama(prompt, attempt = 0) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(OLLAMA_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: prompt,
        stream: false
      }),
      signal: controller.signal
    });

    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`Ollama returned HTTP ${response.status}`);
    }

    const data = await response.json();
    return (data.response || '').trim();
  } catch (err) {
    clearTimeout(timer);
    if (attempt < MAX_RETRIES) {
      console.warn('[QuizSolver] Ollama request failed, retrying...', err.message);
      return queryOllama(prompt, attempt + 1);
    }
    throw err;
  }
}

/**
 * Build the AI prompt from question and choices.
 * @param {string} question
 * @param {string[]} choices
 * @returns {string}
 */
function buildPrompt(question, choices) {
  const choicesText = choices
    .map((c, i) => `${String.fromCharCode(65 + i)}. ${c}`)
    .join('\n');

  return `You are an expert quiz solver.
Return ONLY the correct answer (A/B/C/D or exact answer text).
No explanation.

Question:
${question}

Choices:
${choicesText}`;
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SOLVE_QUESTION') {
    const { question, choices } = message.payload;
    const prompt = buildPrompt(question, choices);

    queryOllama(prompt)
      .then(answer => {
        sendResponse({ success: true, answer });
      })
      .catch(err => {
        console.error('[QuizSolver] AI query failed:', err.message);
        sendResponse({ success: false, error: err.message });
      });

    // Return true to indicate async response
    return true;
  }

  if (message.type === 'CAPTURE_SCREENSHOT') {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'No tab ID' });
      return false;
    }

    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' })
      .then(dataUrl => sendResponse({ success: true, dataUrl }))
      .catch(err => {
        console.error('[QuizSolver] Screenshot failed:', err.message);
        sendResponse({ success: false, error: err.message });
      });

    return true;
  }
});
