/**
 * Options / Settings Page — Open Meeting Scribe
 *
 * Handles saving / loading:
 *   - OpenAI API key
 *   - Provider settings (cleanup + summary)
 *   - Experimental: Meet captions toggle
 */

import {
  STORAGE_KEYS,
  getApiKey,
  setApiKey,
  clearApiKey,
  getProviderSettings,
  setProviderSettings,
  getUseMeetCaptions,
  setUseMeetCaptions,
} from '../lib/storage.js';

// ---------------------------------------------------------------------------
// DOM references — API key
// ---------------------------------------------------------------------------

const apiKeyInput         = document.getElementById('api-key');
const toggleVisibilityBtn = document.getElementById('toggle-visibility');
const eyeIcon             = document.getElementById('eye-icon');
const apiKeyStatus        = document.getElementById('api-key-status');
const btnSaveKey          = document.getElementById('btn-save-key');
const btnClearKey         = document.getElementById('btn-clear-key');

// ---------------------------------------------------------------------------
// DOM references — providers
// ---------------------------------------------------------------------------

const apiKeySection         = document.getElementById('api-key-section');

const cleanupProviderSelect = document.getElementById('cleanup-provider');
const summaryProviderSelect = document.getElementById('summary-provider');
const btnSaveProviders      = document.getElementById('btn-save-providers');
const providersStatus       = document.getElementById('providers-status');

// Cleanup provider field containers
const cleanupFieldSets = {
  openai:   document.getElementById('cleanup-fields-openai'),
  lmstudio: document.getElementById('cleanup-fields-lmstudio'),
  ollama:   document.getElementById('cleanup-fields-ollama'),
  custom:   document.getElementById('cleanup-fields-custom'),
};

// Summary provider field containers
const summaryFieldSets = {
  openai:    document.getElementById('summary-fields-openai'),
  deepseek:  document.getElementById('summary-fields-deepseek'),
  lmstudio:  document.getElementById('summary-fields-lmstudio'),
  ollama:    document.getElementById('summary-fields-ollama'),
  custom:    document.getElementById('summary-fields-custom'),
};

// ---------------------------------------------------------------------------
// DOM references — experimental
// ---------------------------------------------------------------------------

const useMeetCaptionsToggle = document.getElementById('use-meet-captions');
const captionsStatus        = document.getElementById('captions-status');

const toast = document.getElementById('toast');

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
// Provider field visibility
// ---------------------------------------------------------------------------

function showProviderFields(fieldSets, selectedProvider) {
  for (const [id, el] of Object.entries(fieldSets)) {
    el.classList.toggle('hidden', id !== selectedProvider);
  }
}

function updateApiKeyVisibility() {
  const needsOpenAIKey =
    cleanupProviderSelect.value === 'openai' ||
    summaryProviderSelect.value === 'openai';
  apiKeySection.classList.toggle('hidden', !needsOpenAIKey);
}

cleanupProviderSelect.addEventListener('change', () => {
  showProviderFields(cleanupFieldSets, cleanupProviderSelect.value);
  updateApiKeyVisibility();
});

summaryProviderSelect.addEventListener('change', () => {
  showProviderFields(summaryFieldSets, summaryProviderSelect.value);
  updateApiKeyVisibility();
});

// ---------------------------------------------------------------------------
// Provider settings — save
// ---------------------------------------------------------------------------

btnSaveProviders.addEventListener('click', async () => {
  btnSaveProviders.disabled = true;
  try {
    const cleanupProvider = cleanupProviderSelect.value;
    const summaryProvider = summaryProviderSelect.value;

    const settings = {
      [STORAGE_KEYS.CLEANUP_PROVIDER]: cleanupProvider,
      [STORAGE_KEYS.SUMMARY_PROVIDER]: summaryProvider,
    };

    // Collect cleanup fields based on selected provider
    switch (cleanupProvider) {
      case 'openai':
        settings[STORAGE_KEYS.CLEANUP_MODEL] =
          document.getElementById('cleanup-openai-model').value;
        break;
      case 'lmstudio':
        settings[STORAGE_KEYS.CLEANUP_BASE_URL] =
          document.getElementById('cleanup-lmstudio-url').value.trim();
        settings[STORAGE_KEYS.CLEANUP_MODEL] =
          document.getElementById('cleanup-lmstudio-model').value.trim();
        break;
      case 'ollama':
        settings[STORAGE_KEYS.CLEANUP_BASE_URL] =
          document.getElementById('cleanup-ollama-url').value.trim();
        settings[STORAGE_KEYS.CLEANUP_MODEL] =
          document.getElementById('cleanup-ollama-model').value.trim();
        break;
      case 'custom':
        settings[STORAGE_KEYS.CLEANUP_BASE_URL] =
          document.getElementById('cleanup-custom-url').value.trim();
        settings[STORAGE_KEYS.CLEANUP_API_KEY] =
          document.getElementById('cleanup-custom-key').value.trim();
        settings[STORAGE_KEYS.CLEANUP_MODEL] =
          document.getElementById('cleanup-custom-model').value.trim();
        break;
    }

    // Collect summary fields based on selected provider
    switch (summaryProvider) {
      case 'openai':
        settings[STORAGE_KEYS.SUMMARY_MODEL] =
          document.getElementById('summary-openai-model').value;
        break;
      case 'deepseek':
        settings[STORAGE_KEYS.SUMMARY_API_KEY] =
          document.getElementById('summary-deepseek-key').value.trim();
        settings[STORAGE_KEYS.SUMMARY_MODEL] =
          document.getElementById('summary-deepseek-model').value;
        break;
      case 'lmstudio':
        settings[STORAGE_KEYS.SUMMARY_BASE_URL] =
          document.getElementById('summary-lmstudio-url').value.trim();
        settings[STORAGE_KEYS.SUMMARY_MODEL] =
          document.getElementById('summary-lmstudio-model').value.trim();
        break;
      case 'ollama':
        settings[STORAGE_KEYS.SUMMARY_BASE_URL] =
          document.getElementById('summary-ollama-url').value.trim();
        settings[STORAGE_KEYS.SUMMARY_MODEL] =
          document.getElementById('summary-ollama-model').value.trim();
        break;
      case 'custom':
        settings[STORAGE_KEYS.SUMMARY_BASE_URL] =
          document.getElementById('summary-custom-url').value.trim();
        settings[STORAGE_KEYS.SUMMARY_API_KEY] =
          document.getElementById('summary-custom-key').value.trim();
        settings[STORAGE_KEYS.SUMMARY_MODEL] =
          document.getElementById('summary-custom-model').value.trim();
        break;
    }

    await setProviderSettings(settings);
    setStatus(providersStatus, 'Provider settings saved.', 'success');
    showToast('Providers saved!');
    setTimeout(() => setStatus(providersStatus, ''), 3000);
  } finally {
    btnSaveProviders.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// API key validation
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
// Experimental: Meet captions toggle
// ---------------------------------------------------------------------------

useMeetCaptionsToggle.addEventListener('change', async () => {
  await setUseMeetCaptions(useMeetCaptionsToggle.checked);
  setStatus(
    captionsStatus,
    useMeetCaptionsToggle.checked
      ? 'Meet captions enabled. Fallback to speech recognition is always active.'
      : 'Meet captions disabled. Standard speech recognition will be used.',
    useMeetCaptionsToggle.checked ? 'success' : '',
  );
  setTimeout(() => setStatus(captionsStatus, ''), 4000);
});

// ---------------------------------------------------------------------------
// Initialise — load existing settings
// ---------------------------------------------------------------------------

async function init() {
  const [existingKey, providerSettings, useCaptions] = await Promise.all([
    getApiKey(),
    getProviderSettings(),
    getUseMeetCaptions(),
  ]);

  if (existingKey) {
    apiKeyInput.value = existingKey;
    setStatus(apiKeyStatus, 'A key is currently saved.', 'success');
  }

  // --- Restore cleanup provider ---
  const cleanupProvider = providerSettings[STORAGE_KEYS.CLEANUP_PROVIDER] ?? 'openai';
  cleanupProviderSelect.value = cleanupProvider;
  showProviderFields(cleanupFieldSets, cleanupProvider);

  // Populate cleanup model fields
  const cleanupModel = providerSettings[STORAGE_KEYS.CLEANUP_MODEL] ?? '';
  const cleanupUrl   = providerSettings[STORAGE_KEYS.CLEANUP_BASE_URL] ?? '';
  const cleanupKey   = providerSettings[STORAGE_KEYS.CLEANUP_API_KEY] ?? '';

  setSelectOrInput('cleanup-openai-model',   cleanupModel);
  document.getElementById('cleanup-lmstudio-url').value   = cleanupUrl   || 'http://localhost:1234/v1';
  document.getElementById('cleanup-lmstudio-model').value = cleanupModel;
  document.getElementById('cleanup-ollama-url').value     = cleanupUrl   || 'http://localhost:11434/v1';
  document.getElementById('cleanup-ollama-model').value   = cleanupModel;
  document.getElementById('cleanup-custom-url').value     = cleanupUrl;
  document.getElementById('cleanup-custom-key').value     = cleanupKey;
  document.getElementById('cleanup-custom-model').value   = cleanupModel;

  // --- Restore summary provider ---
  const summaryProvider = providerSettings[STORAGE_KEYS.SUMMARY_PROVIDER] ?? 'openai';
  summaryProviderSelect.value = summaryProvider;
  showProviderFields(summaryFieldSets, summaryProvider);

  // Populate summary model fields
  const summaryModel = providerSettings[STORAGE_KEYS.SUMMARY_MODEL] ?? '';
  const summaryUrl   = providerSettings[STORAGE_KEYS.SUMMARY_BASE_URL] ?? '';
  const summaryKey   = providerSettings[STORAGE_KEYS.SUMMARY_API_KEY] ?? '';

  setSelectOrInput('summary-openai-model',    summaryModel);
  setSelectOrInput('summary-deepseek-model',  summaryModel);
  document.getElementById('summary-deepseek-key').value    = summaryKey;
  document.getElementById('summary-lmstudio-url').value    = summaryUrl   || 'http://localhost:1234/v1';
  document.getElementById('summary-lmstudio-model').value  = summaryModel;
  document.getElementById('summary-ollama-url').value      = summaryUrl   || 'http://localhost:11434/v1';
  document.getElementById('summary-ollama-model').value    = summaryModel;
  document.getElementById('summary-custom-url').value      = summaryUrl;
  document.getElementById('summary-custom-key').value      = summaryKey;
  document.getElementById('summary-custom-model').value    = summaryModel;

  // --- Restore experimental ---
  useMeetCaptionsToggle.checked = useCaptions;

  updateApiKeyVisibility();
}

/**
 * Sets a <select> value if the option exists, otherwise sets an <input> value.
 * For selects, falls back gracefully when the saved value isn't in the list.
 */
function setSelectOrInput(elementId, value) {
  if (!value) return;
  const el = document.getElementById(elementId);
  if (!el) return;

  if (el.tagName === 'SELECT') {
    const exists = Array.from(el.options).some((o) => o.value === value);
    if (!exists) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      el.appendChild(opt);
    }
    el.value = value;
  } else {
    el.value = value;
  }
}

init();
