/**
 * ProviderRegistry
 *
 * Factory that reads provider settings from chrome.storage.local and returns
 * configured provider instances for the cleanup and summarise steps.
 *
 * Supported provider IDs:
 *   Cleanup:  'openai' | 'skip' | 'lmstudio' | 'ollama' | 'custom'
 *   Summary:  'openai' | 'deepseek' | 'lmstudio' | 'ollama' | 'custom'
 *
 * Default base URLs:
 *   OpenAI   → https://api.openai.com/v1
 *   DeepSeek → https://api.deepseek.com/v1
 *   LM Studio (cleanup default) → http://localhost:1234/v1
 *   LM Studio (summary default) → http://localhost:1234/v1
 *   Ollama   → http://localhost:11434/v1
 *
 * Backward-compatible: if new provider keys are absent, falls back to
 * the legacy openai_api_key / preferred_summary_model / final_transcript_model.
 */

import { OpenAICompatibleProvider } from './OpenAICompatibleProvider.js';
import { SkipCleanupProvider }       from './SkipCleanupProvider.js';
import { STORAGE_KEYS }              from '../storage.js';

const DEFAULT_OPENAI_BASE    = 'https://api.openai.com/v1';
const DEFAULT_DEEPSEEK_BASE  = 'https://api.deepseek.com/v1';
const DEFAULT_LMSTUDIO_BASE  = 'http://localhost:1234/v1';
const DEFAULT_OLLAMA_BASE    = 'http://localhost:11434/v1';

const DEFAULT_CLEANUP_MODEL  = 'gpt-4o-mini';
const DEFAULT_SUMMARY_MODEL  = 'gpt-4o-mini';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns a configured cleanup provider.
 * @returns {Promise<{cleanup: (rawTranscript: string) => Promise<string>}>}
 */
export async function getCleanupProvider() {
  const settings = await loadProviderSettings();

  const providerId = settings[STORAGE_KEYS.CLEANUP_PROVIDER] ?? 'openai';

  if (providerId === 'skip') {
    return new SkipCleanupProvider();
  }

  const { baseUrl, apiKey, model } = resolveCleanupConfig(providerId, settings);

  return new OpenAICompatibleProvider({
    baseUrl,
    apiKey,
    cleanupModel: model,
    summaryModel: model, // not used by cleanup path
  });
}

/**
 * Returns a configured summary provider.
 * @returns {Promise<{summarize: (transcript: string) => Promise<import('./OpenAICompatibleProvider.js').MeetingNotes>}>}
 */
export async function getSummaryProvider() {
  const settings = await loadProviderSettings();

  const providerId = settings[STORAGE_KEYS.SUMMARY_PROVIDER] ?? 'openai';
  const { baseUrl, apiKey, model } = resolveSummaryConfig(providerId, settings);

  return new OpenAICompatibleProvider({
    baseUrl,
    apiKey,
    cleanupModel: model, // not used by summary path
    summaryModel: model,
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function loadProviderSettings() {
  const keys = [
    STORAGE_KEYS.API_KEY,
    STORAGE_KEYS.PREFERRED_MODEL,
    STORAGE_KEYS.FINAL_TRANSCRIPT_MODEL,
    STORAGE_KEYS.SUMMARY_PROVIDER,
    STORAGE_KEYS.SUMMARY_BASE_URL,
    STORAGE_KEYS.SUMMARY_API_KEY,
    STORAGE_KEYS.SUMMARY_MODEL,
    STORAGE_KEYS.CLEANUP_PROVIDER,
    STORAGE_KEYS.CLEANUP_BASE_URL,
    STORAGE_KEYS.CLEANUP_API_KEY,
    STORAGE_KEYS.CLEANUP_MODEL,
  ];
  return chrome.storage.local.get(keys);
}

function resolveCleanupConfig(providerId, settings) {
  const legacyOpenAIKey   = settings[STORAGE_KEYS.API_KEY]               ?? null;
  const legacyCleanupModel = settings[STORAGE_KEYS.FINAL_TRANSCRIPT_MODEL] ?? DEFAULT_CLEANUP_MODEL;

  switch (providerId) {
    case 'openai':
      return {
        baseUrl: DEFAULT_OPENAI_BASE,
        apiKey:  legacyOpenAIKey,
        model:   settings[STORAGE_KEYS.CLEANUP_MODEL] ?? legacyCleanupModel,
      };

    case 'lmstudio':
      return {
        baseUrl: settings[STORAGE_KEYS.CLEANUP_BASE_URL] ?? DEFAULT_LMSTUDIO_BASE,
        apiKey:  settings[STORAGE_KEYS.CLEANUP_API_KEY]  ?? null,
        model:   settings[STORAGE_KEYS.CLEANUP_MODEL]    ?? DEFAULT_CLEANUP_MODEL,
      };

    case 'ollama':
      return {
        baseUrl: settings[STORAGE_KEYS.CLEANUP_BASE_URL] ?? DEFAULT_OLLAMA_BASE,
        apiKey:  settings[STORAGE_KEYS.CLEANUP_API_KEY]  ?? null,
        model:   settings[STORAGE_KEYS.CLEANUP_MODEL]    ?? DEFAULT_CLEANUP_MODEL,
      };

    case 'custom':
      return {
        baseUrl: settings[STORAGE_KEYS.CLEANUP_BASE_URL] ?? '',
        apiKey:  settings[STORAGE_KEYS.CLEANUP_API_KEY]  ?? null,
        model:   settings[STORAGE_KEYS.CLEANUP_MODEL]    ?? DEFAULT_CLEANUP_MODEL,
      };

    default:
      return {
        baseUrl: DEFAULT_OPENAI_BASE,
        apiKey:  legacyOpenAIKey,
        model:   legacyCleanupModel,
      };
  }
}

function resolveSummaryConfig(providerId, settings) {
  const legacyOpenAIKey    = settings[STORAGE_KEYS.API_KEY]          ?? null;
  const legacySummaryModel = settings[STORAGE_KEYS.PREFERRED_MODEL]  ?? DEFAULT_SUMMARY_MODEL;

  switch (providerId) {
    case 'openai':
      return {
        baseUrl: DEFAULT_OPENAI_BASE,
        apiKey:  legacyOpenAIKey,
        model:   settings[STORAGE_KEYS.SUMMARY_MODEL] ?? legacySummaryModel,
      };

    case 'deepseek':
      return {
        baseUrl: DEFAULT_DEEPSEEK_BASE,
        apiKey:  settings[STORAGE_KEYS.SUMMARY_API_KEY] ?? null,
        model:   settings[STORAGE_KEYS.SUMMARY_MODEL]   ?? 'deepseek-chat',
      };

    case 'lmstudio':
      return {
        baseUrl: settings[STORAGE_KEYS.SUMMARY_BASE_URL] ?? DEFAULT_LMSTUDIO_BASE,
        apiKey:  settings[STORAGE_KEYS.SUMMARY_API_KEY]  ?? null,
        model:   settings[STORAGE_KEYS.SUMMARY_MODEL]    ?? DEFAULT_SUMMARY_MODEL,
      };

    case 'ollama':
      return {
        baseUrl: settings[STORAGE_KEYS.SUMMARY_BASE_URL] ?? DEFAULT_OLLAMA_BASE,
        apiKey:  settings[STORAGE_KEYS.SUMMARY_API_KEY]  ?? null,
        model:   settings[STORAGE_KEYS.SUMMARY_MODEL]    ?? DEFAULT_SUMMARY_MODEL,
      };

    case 'custom':
      return {
        baseUrl: settings[STORAGE_KEYS.SUMMARY_BASE_URL] ?? '',
        apiKey:  settings[STORAGE_KEYS.SUMMARY_API_KEY]  ?? null,
        model:   settings[STORAGE_KEYS.SUMMARY_MODEL]    ?? DEFAULT_SUMMARY_MODEL,
      };

    default:
      return {
        baseUrl: DEFAULT_OPENAI_BASE,
        apiKey:  legacyOpenAIKey,
        model:   legacySummaryModel,
      };
  }
}
