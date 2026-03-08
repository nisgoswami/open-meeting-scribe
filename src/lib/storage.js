/**
 * Storage utilities for Open Meeting Scribe.
 *
 * API keys are persisted to chrome.storage.local (encrypted at rest by Chrome).
 * Session state uses chrome.storage.session (in-memory, cleared on browser close).
 * Meeting audio never touches any storage layer — it lives only in the offscreen
 * document's JavaScript heap until processing is complete.
 */

/** Keys used across storage layers. */
export const STORAGE_KEYS = {
  API_KEY: 'openai_api_key',
  /** GPT model for meeting summary generation (legacy; used as OpenAI fallback). */
  PREFERRED_MODEL: 'preferred_summary_model',
  /** Model used for per-segment live transcription (audio → text). */
  LIVE_TRANSCRIPT_MODEL: 'live_transcript_model',
  /** Model used for the final transcript cleanup pass (legacy; used as OpenAI fallback). */
  FINAL_TRANSCRIPT_MODEL: 'final_transcript_model',
  /** Whether to attempt Meet caption scraping before speech recognition. */
  USE_MEET_CAPTIONS: 'use_meet_captions',

  // ── Provider settings ──────────────────────────────────────────────────────
  /** Provider for meeting summary: 'openai' | 'deepseek' | 'lmstudio' | 'ollama' | 'custom' */
  SUMMARY_PROVIDER: 'summary_provider',
  /** Base URL for summary provider (lmstudio / ollama / custom). */
  SUMMARY_BASE_URL: 'summary_base_url',
  /** API key for summary provider (deepseek / custom). */
  SUMMARY_API_KEY: 'summary_api_key',
  /** Model override for summary provider. */
  SUMMARY_MODEL: 'summary_model',

  /** Provider for transcript cleanup: 'openai' | 'skip' | 'lmstudio' | 'ollama' | 'custom' */
  CLEANUP_PROVIDER: 'cleanup_provider',
  /** Base URL for cleanup provider (lmstudio / ollama / custom). */
  CLEANUP_BASE_URL: 'cleanup_base_url',
  /** API key for cleanup provider (custom). */
  CLEANUP_API_KEY: 'cleanup_api_key',
  /** Model override for cleanup provider. */
  CLEANUP_MODEL: 'cleanup_model',
  STATE: 'extension_state',
  NOTES: 'meeting_notes',
  RECORDING_TAB_ID: 'recording_tab_id',
  /** Running transcript built from TRANSCRIPT_CHUNK messages during recording. */
  LIVE_TRANSCRIPT: 'live_transcript',
  /** Cleaned-up transcript produced after recording stops. */
  FINAL_TRANSCRIPT: 'final_transcript',
  /**
   * Array of completed meeting sessions stored in session memory.
   * Each entry: { id, timestamp, liveTranscript, finalTranscript, notes }
   * Cleared on browser close (chrome.storage.session).
   */
  MEETING_HISTORY: 'meeting_history',
};

/** Extension state values. */
export const STATE = {
  IDLE: 'IDLE',
  RECORDING: 'RECORDING',
  PROCESSING: 'PROCESSING',
  DONE: 'DONE',
  ERROR: 'ERROR',
};

// ---------------------------------------------------------------------------
// API key — persisted to chrome.storage.local
// ---------------------------------------------------------------------------

export async function getApiKey() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.API_KEY);
  return result[STORAGE_KEYS.API_KEY] ?? null;
}

export async function setApiKey(key) {
  await chrome.storage.local.set({ [STORAGE_KEYS.API_KEY]: key });
}

export async function clearApiKey() {
  await chrome.storage.local.remove(STORAGE_KEYS.API_KEY);
}

// ---------------------------------------------------------------------------
// Model preference — persisted to chrome.storage.local
// ---------------------------------------------------------------------------

export async function getPreferredModel() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.PREFERRED_MODEL);
  return result[STORAGE_KEYS.PREFERRED_MODEL] ?? 'gpt-5-mini';
}

export async function setPreferredModel(model) {
  await chrome.storage.local.set({ [STORAGE_KEYS.PREFERRED_MODEL]: model });
}

export async function getLiveTranscriptModel() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.LIVE_TRANSCRIPT_MODEL);
  return result[STORAGE_KEYS.LIVE_TRANSCRIPT_MODEL] ?? 'gpt-realtime-mini';
}

export async function setLiveTranscriptModel(model) {
  await chrome.storage.local.set({ [STORAGE_KEYS.LIVE_TRANSCRIPT_MODEL]: model });
}

export async function getFinalTranscriptModel() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.FINAL_TRANSCRIPT_MODEL);
  return result[STORAGE_KEYS.FINAL_TRANSCRIPT_MODEL] ?? 'gpt-4o-transcribe';
}

export async function setFinalTranscriptModel(model) {
  await chrome.storage.local.set({ [STORAGE_KEYS.FINAL_TRANSCRIPT_MODEL]: model });
}

// ---------------------------------------------------------------------------
// Experimental settings — persisted to chrome.storage.local
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Provider settings — persisted to chrome.storage.local
// ---------------------------------------------------------------------------

export async function getProviderSettings() {
  const keys = [
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

export async function setProviderSettings(settings) {
  const allowed = [
    STORAGE_KEYS.SUMMARY_PROVIDER,
    STORAGE_KEYS.SUMMARY_BASE_URL,
    STORAGE_KEYS.SUMMARY_API_KEY,
    STORAGE_KEYS.SUMMARY_MODEL,
    STORAGE_KEYS.CLEANUP_PROVIDER,
    STORAGE_KEYS.CLEANUP_BASE_URL,
    STORAGE_KEYS.CLEANUP_API_KEY,
    STORAGE_KEYS.CLEANUP_MODEL,
  ];
  const toSave = {};
  for (const key of allowed) {
    if (settings[key] !== undefined) toSave[key] = settings[key];
  }
  if (Object.keys(toSave).length > 0) {
    await chrome.storage.local.set(toSave);
  }
}

// ---------------------------------------------------------------------------
// Experimental settings — persisted to chrome.storage.local
// ---------------------------------------------------------------------------

/** Returns true if the experimental Meet captions transcript source is enabled. */
export async function getUseMeetCaptions() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.USE_MEET_CAPTIONS);
  return result[STORAGE_KEYS.USE_MEET_CAPTIONS] ?? false;
}

export async function setUseMeetCaptions(value) {
  await chrome.storage.local.set({ [STORAGE_KEYS.USE_MEET_CAPTIONS]: Boolean(value) });
}

// ---------------------------------------------------------------------------
// Session state — uses chrome.storage.session (in-memory, never persisted)
// ---------------------------------------------------------------------------

export async function getSessionState() {
  const result = await chrome.storage.session.get([
    STORAGE_KEYS.STATE,
    STORAGE_KEYS.NOTES,
    STORAGE_KEYS.RECORDING_TAB_ID,
    STORAGE_KEYS.LIVE_TRANSCRIPT,
    STORAGE_KEYS.FINAL_TRANSCRIPT,
  ]);
  return {
    state: result[STORAGE_KEYS.STATE] ?? STATE.IDLE,
    notes: result[STORAGE_KEYS.NOTES] ?? null,
    recordingTabId: result[STORAGE_KEYS.RECORDING_TAB_ID] ?? null,
    liveTranscript: result[STORAGE_KEYS.LIVE_TRANSCRIPT] ?? '',
    finalTranscript: result[STORAGE_KEYS.FINAL_TRANSCRIPT] ?? '',
  };
}

export async function setSessionState(state) {
  await chrome.storage.session.set({ [STORAGE_KEYS.STATE]: state });
}

export async function setRecordingTabId(tabId) {
  await chrome.storage.session.set({ [STORAGE_KEYS.RECORDING_TAB_ID]: tabId });
}

export async function setNotes(notes) {
  await chrome.storage.session.set({ [STORAGE_KEYS.NOTES]: notes });
}

export async function setLiveTranscript(text) {
  await chrome.storage.session.set({ [STORAGE_KEYS.LIVE_TRANSCRIPT]: text });
}

export async function setFinalTranscript(text) {
  await chrome.storage.session.set({ [STORAGE_KEYS.FINAL_TRANSCRIPT]: text });
}

/** Clears all session data: state, notes, transcripts, and recording metadata. */
export async function clearSessionData() {
  await chrome.storage.session.remove([
    STORAGE_KEYS.STATE,
    STORAGE_KEYS.NOTES,
    STORAGE_KEYS.RECORDING_TAB_ID,
    STORAGE_KEYS.LIVE_TRANSCRIPT,
    STORAGE_KEYS.FINAL_TRANSCRIPT,
  ]);
}

// ---------------------------------------------------------------------------
// Meeting history — uses chrome.storage.session (in-memory, never persisted)
// ---------------------------------------------------------------------------

/**
 * Returns all saved meeting sessions, oldest first.
 * @returns {Promise<Array<{id: string, timestamp: number, liveTranscript: string, finalTranscript: string, notes: object}>>}
 */
export async function getHistory() {
  const result = await chrome.storage.session.get(STORAGE_KEYS.MEETING_HISTORY);
  return result[STORAGE_KEYS.MEETING_HISTORY] ?? [];
}

/**
 * Appends a completed meeting session to the history array.
 * @param {{ id: string, timestamp: number, liveTranscript: string, finalTranscript: string, notes: object }} entry
 */
export async function appendToHistory(entry) {
  const history = await getHistory();
  history.push(entry);
  await chrome.storage.session.set({ [STORAGE_KEYS.MEETING_HISTORY]: history });
}

/** Removes all saved meeting history. */
export async function clearHistory() {
  await chrome.storage.session.remove(STORAGE_KEYS.MEETING_HISTORY);
}

/**
 * Removes specific meeting history entries by their ids.
 * @param {string[]} ids - Array of entry ids to remove.
 */
export async function deleteHistoryEntries(ids) {
  const idSet = new Set(ids);
  const history = await getHistory();
  const filtered = history.filter((entry) => !idSet.has(entry.id));
  await chrome.storage.session.set({ [STORAGE_KEYS.MEETING_HISTORY]: filtered });
}
