/**
 * utils.js
 * Utility functions: text normalization, fuzzy answer matching, Q&A cache.
 * Loaded before content.js via manifest content_scripts array.
 */

// Simple in-memory Q&A cache to avoid duplicate AI calls
const QA_CACHE = new Map();

/** Minimum similarity score to accept a fuzzy match */
const SIMILARITY_THRESHOLD = 0.3;

/**
 * Normalize a string for comparison:
 * - Lowercase
 * - Remove punctuation / extra whitespace
 * - Trim
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // keep letters (incl. Unicode) and digits
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculate simple word-overlap similarity between two strings (0–1).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function similarity(a, b) {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const wordsA = new Set(na.split(' '));
  const wordsB = new Set(nb.split(' '));
  let intersection = 0;
  wordsA.forEach(w => { if (wordsB.has(w)) intersection++; });
  return (2 * intersection) / (wordsA.size + wordsB.size);
}

/**
 * Find the best-matching choice element given the AI response.
 *
 * Strategy:
 * 1. If AI returned a letter (A/B/C/D), use it as index.
 * 2. Exact normalized match.
 * 3. "Includes" match (AI answer contained in choice or vice-versa).
 * 4. Highest similarity score (threshold 0.3).
 * 5. Fallback: longest / most-detailed choice.
 *
 * @param {string} aiAnswer - Raw AI response text
 * @param {{ text: string, element: Element }[]} choices
 * @returns {{ text: string, element: Element } | null}
 */
function matchAnswer(aiAnswer, choices) {
  if (!aiAnswer || !choices.length) return null;

  const trimmed = aiAnswer.trim();
  const normalized = normalizeText(trimmed);

  // 1. Letter answer: A / B / C / D (optionally followed by .)
  const letterMatch = trimmed.match(/^([A-Da-d])[\.\):]?\s*/);
  if (letterMatch) {
    const idx = letterMatch[1].toUpperCase().charCodeAt(0) - 65;
    if (idx >= 0 && idx < choices.length) {
      console.debug('[QuizSolver] Matched by letter index:', letterMatch[1], '->', choices[idx].text);
      return choices[idx];
    }
  }

  // 2. Exact normalized match
  for (const choice of choices) {
    if (normalizeText(choice.text) === normalized) {
      console.debug('[QuizSolver] Matched by exact text:', choice.text);
      return choice;
    }
  }

  // 3. Includes match
  for (const choice of choices) {
    const nc = normalizeText(choice.text);
    if (nc.includes(normalized) || normalized.includes(nc)) {
      console.debug('[QuizSolver] Matched by includes:', choice.text);
      return choice;
    }
  }

  // 4. Best similarity
  let best = null;
  let bestScore = SIMILARITY_THRESHOLD;
  for (const choice of choices) {
    const score = similarity(trimmed, choice.text);
    if (score > bestScore) {
      bestScore = score;
      best = choice;
    }
  }
  if (best) {
    console.debug('[QuizSolver] Matched by similarity (%.2f):', bestScore, best.text);
    return best;
  }

  // 5. Fallback: longest / most detailed option
  const fallback = choices.reduce((a, b) => (b.text.length > a.text.length ? b : a), choices[0]);
  console.debug('[QuizSolver] Fallback to longest answer:', fallback.text);
  return fallback;
}

/**
 * Return a random integer in [min, max].
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Sleep for the given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Cache a question → answer mapping.
 * @param {string} question
 * @param {string} answer
 */
function cacheAnswer(question, answer) {
  QA_CACHE.set(normalizeText(question), answer);
}

/**
 * Retrieve a cached answer for a question, or null if not cached.
 * @param {string} question
 * @returns {string | null}
 */
function getCachedAnswer(question) {
  return QA_CACHE.get(normalizeText(question)) || null;
}
