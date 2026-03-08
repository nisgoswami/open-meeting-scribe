/**
 * Options / Settings Page — Open Meeting Scribe
 *
 * Handles saving / loading:
 *   - OpenAI API key (chrome.storage.local, Chrome-encrypted)
 *   - Live transcript model preference
 *   - Final transcript model preference
 *   - Meeting summary model preference
 */

import {
  getApiKey,
  setApiKey,
  clearApiKey,
  getPreferredModel,
  setPreferredModel,
  getLiveTranscriptModel,
  setLiveTranscriptModel,
  getFinalTranscriptModel,
  setFinalTranscriptModel,
} from '../lib/storage.js';

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const apiKeyInput         = document.getElementById('api-key');
const toggleVisibilityBtn = document.getElementById('toggle-visibility');
const eyeIcon             = document.getElementById('eye-icon');
const apiKeyStatus        = document.getElementById('api-key-status');
const btnSaveKey          = document.getElementById('btn-save-key');
const btnClearKey         = document.getElementById('btn-clear-key');

const liveModelSelect     = document.getElementById('live-model-select');
const finalModelSelect    = document.getElementById('final-model-select');
const summaryModelSelect  = document.getElementById('summary-model-select');
const modelsStatus        = document.getElementById('models-status');
const btnSaveModels       = document.getElementById('btn-save-models');

const toast               = document.getElementById('toast');

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

let toastTimer = null;

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 2500);
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function setStatus(el, msg, type = '') {
  el.textContent = msg;
  el.className = `field-status ${type}`;
}

// ---------------------------------------------------------------------------
// API key visibility toggle
// ---------------------------------------------------------------------------

toggleVisibilityBtn.addEventListener('click', () => {
  const isPassword = apiKeyInput.type === 'password';
  apiKeyInput.type = isPassword ? 'text' : 'password';
  eyeIcon.innerHTML = isPassword
    ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
       <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
       <line x1="1" y1="1" x2="23" y2="23"/>`
    : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
       <circle cx="12" cy="12" r="3"/>`;
});

// ---------------------------------------------------------------------------
// API key — save
// ---------------------------------------------------------------------------

btnSaveKey.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();

  if (!key) {
    setStatus(apiKeyStatus, 'Please enter an API key.', 'error');
    return;
  }

  if (!key.startsWith('sk-')) {
    setStatus(apiKeyStatus, 'API keys typically start with "sk-". Double-check your key.', 'error');
    return;
  }

  btnSaveKey.disabled = true;
  setStatus(apiKeyStatus, 'Validating key…');

  try {
    await validateApiKey(key);
    await setApiKey(key);
    setStatus(apiKeyStatus, 'API key saved successfully.', 'success');
    showToast('API key saved!');
  } catch (err) {
    setStatus(apiKeyStatus, err.message, 'error');
  } finally {
    btnSaveKey.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// API key — remove
// ---------------------------------------------------------------------------

btnClearKey.addEventListener('click', async () => {
  await clearApiKey();
  apiKeyInput.value = '';
  setStatus(apiKeyStatus, 'API key removed.', '');
  showToast('API key removed.');
});

// ---------------------------------------------------------------------------
// Model preferences — save all three
// ---------------------------------------------------------------------------

btnSaveModels.addEventListener('click', async () => {
  btnSaveModels.disabled = true;
  try {
    await Promise.all([
      setLiveTranscriptModel(liveModelSelect.value),
      setFinalTranscriptModel(finalModelSelect.value),
      setPreferredModel(summaryModelSelect.value),
    ]);
    setStatus(modelsStatus, 'Model preferences saved.', 'success');
    showToast('Preferences saved!');
    setTimeout(() => setStatus(modelsStatus, ''), 3000);
  } finally {
    btnSaveModels.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// API key validation (free models-list call to verify the key is valid)
// ---------------------------------------------------------------------------

async function validateApiKey(key) {
  const response = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
  });

  if (response.status === 401) {
    throw new Error('Invalid API key. Please check and try again.');
  }

  if (!response.ok) {
    console.warn(`OpenAI validation returned ${response.status}; saving anyway.`);
  }
}

// ---------------------------------------------------------------------------
// Initialise — load existing settings
// ---------------------------------------------------------------------------

async function init() {
  const [existingKey, liveModel, finalModel, summaryModel] = await Promise.all([
    getApiKey(),
    getLiveTranscriptModel(),
    getFinalTranscriptModel(),
    getPreferredModel(),
  ]);

  if (existingKey) {
    apiKeyInput.value = existingKey;
    setStatus(apiKeyStatus, 'A key is currently saved.', 'success');
  }

  // Pre-select saved values; fall back gracefully if a saved value isn't in the list.
  setSelectValue(liveModelSelect,    liveModel);
  setSelectValue(finalModelSelect,   finalModel);
  setSelectValue(summaryModelSelect, summaryModel);
}

/** Sets a <select> value, adding a custom option if the saved value isn't in the list. */
function setSelectValue(selectEl, value) {
  if (!value) return;
  // Try to find a matching option
  const exists = Array.from(selectEl.options).some((o) => o.value === value);
  if (!exists) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    selectEl.appendChild(opt);
  }
  selectEl.value = value;
}

init();
