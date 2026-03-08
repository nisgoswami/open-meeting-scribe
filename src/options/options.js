/**
 * Options / Settings Page — Open Meeting Scribe
 *
 * Handles saving / loading the OpenAI API key and summary model preference.
 * The API key is stored in chrome.storage.local (Chrome encrypts this at rest).
 */

import {
  getApiKey,
  setApiKey,
  clearApiKey,
  getPreferredModel,
  setPreferredModel,
} from '../lib/storage.js';

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const apiKeyInput       = document.getElementById('api-key');
const toggleVisibilityBtn = document.getElementById('toggle-visibility');
const eyeIcon           = document.getElementById('eye-icon');
const apiKeyStatus      = document.getElementById('api-key-status');
const btnSaveKey        = document.getElementById('btn-save-key');
const btnClearKey       = document.getElementById('btn-clear-key');

const modelSelect       = document.getElementById('model-select');
const modelStatus       = document.getElementById('model-status');
const btnSaveModel      = document.getElementById('btn-save-model');

const toast             = document.getElementById('toast');

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

  // Swap icon between eye / eye-off
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
// Model preference — save
// ---------------------------------------------------------------------------

btnSaveModel.addEventListener('click', async () => {
  await setPreferredModel(modelSelect.value);
  setStatus(modelStatus, 'Model preference saved.', 'success');
  showToast('Preference saved!');
  setTimeout(() => setStatus(modelStatus, ''), 3000);
});

// ---------------------------------------------------------------------------
// API key validation (lightweight — just check the key format and a $0 call)
// ---------------------------------------------------------------------------

async function validateApiKey(key) {
  // We make a minimal API call (models list) to confirm the key is valid.
  // This call is free and reveals no user data.
  const response = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
  });

  if (response.status === 401) {
    throw new Error('Invalid API key. Please check and try again.');
  }

  if (!response.ok) {
    // Don't block saving if OpenAI is temporarily unavailable.
    console.warn(`OpenAI validation returned ${response.status}; saving anyway.`);
  }
}

// ---------------------------------------------------------------------------
// Initialise — load existing settings
// ---------------------------------------------------------------------------

async function init() {
  const [existingKey, preferredModel] = await Promise.all([
    getApiKey(),
    getPreferredModel(),
  ]);

  if (existingKey) {
    // Show a masked representation so users know a key is set.
    apiKeyInput.value = existingKey;
    setStatus(apiKeyStatus, 'A key is currently saved.', 'success');
  }

  if (preferredModel && modelSelect) {
    modelSelect.value = preferredModel;
  }
}

init();
