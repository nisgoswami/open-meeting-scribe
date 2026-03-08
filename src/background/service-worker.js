/**
 * Background Service Worker — Open Meeting Scribe
 *
 * Central coordinator for the extension. Manages the state machine and runs
 * the final transcript-cleanup + meeting-notes pipeline via OpenAI.
 *
 * Audio is captured entirely by the side panel using the browser-native
 * SpeechRecognition API — no tab-capture or offscreen document is needed.
 *
 * Message protocol (all messages use a `type` field):
 *
 *   Inbound (from popup / side panel):
 *     GET_STATE          — Caller wants the current state snapshot.
 *     START_RECORDING    — User wants to begin a recording session.
 *     STOP_RECORDING     — User wants to end the recording and generate notes.
 *     CLEAR_NOTES        — User dismissed the notes; clear all session data.
 *     TRANSCRIPT_CHUNK   — Side panel sends each final recognition utterance.
 *                          payload: { text, fullTranscript }
 *     TRANSCRIPT_READY   — Side panel finished capturing; send full transcript.
 *                          payload: { transcript }
 *     RECOGNITION_ERROR  — Fatal mic error from side panel.
 *                          payload: { error: string }
 *
 *   Outbound (broadcast to all extension contexts):
 *     STATE_UPDATE       — Emitted whenever extension state changes.
 */

import {
  STATE,
  getSessionState,
  setSessionState,
  setRecordingTabId,
  setNotes,
  setLiveTranscript,
  setFinalTranscript,
  clearSessionData,
  getApiKey,
  getPreferredModel,
  getFinalTranscriptModel,
  appendToHistory,
} from '../lib/storage.js';

import {
  cleanupTranscript,
  summarizeMeeting,
} from '../lib/openai.js';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let fallbackTimer = null;

// ---------------------------------------------------------------------------
// Broadcast helpers
// ---------------------------------------------------------------------------

async function broadcastState() {
  const snapshot = await getSessionState();
  chrome.runtime.sendMessage({ type: 'STATE_UPDATE', payload: snapshot }).catch(() => {
    // No listeners open — that is fine.
  });
}

// ---------------------------------------------------------------------------
// Recording start
// ---------------------------------------------------------------------------

async function handleStartRecording(senderTabId) {
  const { state } = await getSessionState();

  if (state === STATE.RECORDING || state === STATE.PROCESSING) {
    return { success: false, error: 'A recording is already in progress.' };
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    return {
      success: false,
      error: 'No OpenAI API key found. Please add your key in the extension settings.',
    };
  }

  const tabId = senderTabId ?? (await getActiveMeetTabId());
  if (!tabId) {
    return {
      success: false,
      error: 'Could not find an active Google Meet tab to record.',
    };
  }

  // Open the side panel — SpeechRecognition starts automatically once it
  // receives the RECORDING state update.
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab?.windowId) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }

  await setRecordingTabId(tabId);
  await setSessionState(STATE.RECORDING);
  await broadcastState();
  return { success: true, tabId };
}

// ---------------------------------------------------------------------------
// Recording stop
// ---------------------------------------------------------------------------

async function handleStopRecording() {
  const { state } = await getSessionState();

  if (state !== STATE.RECORDING) {
    return { success: false, error: 'No active recording to stop.' };
  }

  await setSessionState(STATE.PROCESSING);
  await broadcastState();

  // 6-second fallback: if the side panel never sends TRANSCRIPT_READY
  // (e.g., panel is closed or failed to respond), use whatever transcript
  // has been accumulated in session storage.
  fallbackTimer = setTimeout(async () => {
    fallbackTimer = null;
    const { liveTranscript } = await getSessionState();
    if (liveTranscript?.trim()) {
      await processTranscript(liveTranscript);
    } else {
      await setSessionState(STATE.ERROR);
      await chrome.storage.session.set({
        extension_error: 'No transcript captured — was the microphone enabled?',
      });
      await broadcastState();
    }
  }, 6000);

  return { success: true };
}

// ---------------------------------------------------------------------------
// Transcript processing pipeline
// ---------------------------------------------------------------------------

async function processTranscript(rawTranscript) {
  try {
    const [apiKey, finalModel, summaryModel] = await Promise.all([
      getApiKey(),
      getFinalTranscriptModel(),
      getPreferredModel(),
    ]);

    const finalTranscript = await cleanupTranscript(rawTranscript, apiKey, finalModel);
    await setFinalTranscript(finalTranscript);

    const notes = await summarizeMeeting(finalTranscript, apiKey, summaryModel);

    // Read liveTranscript *after* processing so it includes everything the
    // side panel sent via TRANSCRIPT_CHUNK during the session.
    const { liveTranscript } = await getSessionState();

    await Promise.all([
      setNotes(notes),
      setSessionState(STATE.DONE),
      appendToHistory({
        id: Date.now().toString(),
        timestamp: Date.now(),
        liveTranscript,
        finalTranscript,
        notes,
      }),
    ]);

    await broadcastState();
  } catch (err) {
    await setSessionState(STATE.ERROR);
    await chrome.storage.session.set({ extension_error: err.message });
    await broadcastState();
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

async function getActiveMeetTabId() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true,
    url: 'https://meet.google.com/*',
  });
  return tabs[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message;

  switch (type) {

    // --- From popup / side panel ---

    case 'GET_STATE':
      getSessionState().then(sendResponse);
      return true;

    case 'START_RECORDING':
      handleStartRecording(sender.tab?.id ?? payload?.tabId).then(sendResponse);
      return true;

    case 'STOP_RECORDING':
      handleStopRecording().then(sendResponse);
      return true;

    case 'CLEAR_NOTES':
      clearSessionData()
        .then(() => broadcastState())
        .then(() => sendResponse({ success: true }));
      return true;

    case 'TRANSCRIPT_CHUNK':
      // Sent by the side panel on each committed final recognition utterance.
      // Store the running transcript but do NOT relay back to avoid loops —
      // the side panel already updates its own UI directly.
      setLiveTranscript(payload.fullTranscript);
      break;

    case 'TRANSCRIPT_READY':
      // Side panel finished stopping SpeechRecognition and sends the full
      // transcript.  Clear the fallback timer and start the AI pipeline.
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      processTranscript(payload.transcript ?? '');
      break;

    case 'RECOGNITION_ERROR':
      // Fatal microphone error (permission denied, etc.) reported by side panel.
      setSessionState(STATE.ERROR)
        .then(() => chrome.storage.session.set({ extension_error: payload.error }))
        .then(() => broadcastState());
      break;

    default:
      break;
  }
});

// ---------------------------------------------------------------------------
// Extension install / update handling
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
  await clearSessionData();
});

// ---------------------------------------------------------------------------
// Toolbar icon — recording dot overlay
// ---------------------------------------------------------------------------

/**
 * Draws the base icon onto an OffscreenCanvas and optionally overlays a
 * red recording dot in the bottom-right corner.
 *
 * @param {boolean} recording - Whether to render the red dot.
 */
async function updateToolbarIcon(recording) {
  const SIZE = 128;
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');

  const response = await fetch(chrome.runtime.getURL('public/icons/icon128_base.png'));
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  ctx.drawImage(bitmap, 0, 0, SIZE, SIZE);
  bitmap.close();

  if (recording) {
    const cx = SIZE - 26;
    const cy = SIZE - 26;
    const r  = 22;

    ctx.beginPath();
    ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#e53e3e';
    ctx.fill();
  }

  const imageData = ctx.getImageData(0, 0, SIZE, SIZE);
  await chrome.action.setIcon({ imageData: { 128: imageData } });
}

chrome.storage.session.onChanged.addListener((changes) => {
  if (!changes.extension_state) return;
  const newState = changes.extension_state.newValue;
  updateToolbarIcon(newState === 'RECORDING').catch(() => {});
});
