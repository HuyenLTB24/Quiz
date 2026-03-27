/**
 * popup.js
 * Handles the popup UI: toggle enable/disable, status indicator,
 * manual trigger, and cache clearing.
 */

const enableToggle = document.getElementById('enableToggle');
const statusText   = document.getElementById('statusText');
const processingText = document.getElementById('processingText');
const questionPreview = document.getElementById('questionPreview');
const triggerBtn   = document.getElementById('triggerBtn');
const clearCacheBtn = document.getElementById('clearCacheBtn');

// ─── Load persisted state ────────────────────────────────────────────────────

chrome.storage.local.get(['enabled'], (result) => {
  const enabled = result.enabled !== false; // default: true
  enableToggle.checked = enabled;
  updateStatusUI(enabled);
});

// ─── Toggle handler ──────────────────────────────────────────────────────────

enableToggle.addEventListener('change', () => {
  const enabled = enableToggle.checked;
  chrome.storage.local.set({ enabled });
  updateStatusUI(enabled);
  sendToContentScript({ type: 'SET_ENABLED', payload: { enabled } });
});

// ─── Trigger solve now ────────────────────────────────────────────────────────

triggerBtn.addEventListener('click', () => {
  sendToContentScript({ type: 'TRIGGER_NOW' }, () => {
    triggerBtn.textContent = '✅ Triggered!';
    setTimeout(() => { triggerBtn.textContent = '⚡ Solve Now'; }, 1500);
  });
});

// ─── Clear cache ──────────────────────────────────────────────────────────────

clearCacheBtn.addEventListener('click', () => {
  sendToContentScript({ type: 'CLEAR_CACHE' }, () => {
    clearCacheBtn.textContent = '✅ Cleared!';
    setTimeout(() => { clearCacheBtn.textContent = '🗑 Clear Cache'; }, 1500);
  });
});

// ─── Poll content script for status ──────────────────────────────────────────

function pollStatus() {
  sendToContentScript({ type: 'GET_STATUS' }, (response) => {
    if (!response) return;
    const processing = response.isProcessing;
    processingText.textContent = processing ? '⏳ Processing...' : 'Idle';
    processingText.style.color = processing ? '#ffc107' : '#4caf50';

    if (response.lastQuestion) {
      questionPreview.textContent = response.lastQuestion.substring(0, 120);
      questionPreview.classList.remove('empty');
    } else {
      questionPreview.textContent = 'No question detected yet';
      questionPreview.classList.add('empty');
    }
  });
}

// Poll every second while popup is open
setInterval(pollStatus, 1000);
pollStatus();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Update the status indicator in the UI.
 * @param {boolean} enabled
 */
function updateStatusUI(enabled) {
  if (enabled) {
    statusText.innerHTML = '<span class="dot dot-green"></span>Active';
  } else {
    statusText.innerHTML = '<span class="dot dot-red"></span>Paused';
  }
}

/**
 * Send a message to the active tab's content script.
 * @param {object} message
 * @param {function} [callback]
 */
function sendToContentScript(message, callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || !tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
      if (chrome.runtime.lastError) {
        // Content script may not be injected on this page; silently ignore
        return;
      }
      if (callback) callback(response);
    });
  });
}
