/**
 * Background Service Worker — Open Meeting Scribe
 *
 * Central coordinator for the extension. Manages the state machine, bridges
 * the popup and side panel with the offscreen document, and stores transient
 * session state in chrome.storage.session (never on disk).
 *
 * Message protocol (all messages use a `type` field):
 *
 *   Inbound (from popup / side panel):
 *     GET_STATE         — Caller wants the current state snapshot.
 *     START_RECORDING   — User wants to begin recording the active Meet tab.
 *     STOP_RECORDING    — User wants to end the recording and generate notes.
 *     CLEAR_NOTES       — User dismissed the notes; clear all session data.
 *
 *   Inbound (from offscreen document):
 *     RECORDING_STARTED — Offscreen successfully opened the MediaStream.
 *     TRANSCRIPT_CHUNK  — A new 10-second segment has been transcribed.
 *                         payload: { text, fullTranscript, index }
 *     NOTES_READY       — Processing finished.
 *                         payload: { notes: MeetingNotes, finalTranscript: string }
 *     PROCESSING_ERROR  — Something went wrong; payload: { error: string }
 *
 *   Outbound (broadcast to all extension contexts):
 *     STATE_UPDATE      — Emitted whenever extension state changes.
 *     TRANSCRIPT_CHUNK  — Relayed immediately to the side panel.
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
  appendToHistory,
} from '../lib/storage.js';

const OFFSCREEN_URL = chrome.runtime.getURL('src/offscreen/offscreen.html');

// ---------------------------------------------------------------------------
// Offscreen document lifecycle helpers
// ---------------------------------------------------------------------------

async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [OFFSCREEN_URL],
  });
  if (existingContexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: 'MediaRecorder for capturing tab audio during a Google Meet session.',
  });
}

async function closeOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [OFFSCREEN_URL],
  });
  if (existingContexts.length === 0) return;
  await chrome.offscreen.closeDocument();
}

// ---------------------------------------------------------------------------
// Broadcast helpers
// ---------------------------------------------------------------------------

async function broadcastState() {
  const snapshot = await getSessionState();
  chrome.runtime.sendMessage({ type: 'STATE_UPDATE', payload: snapshot }).catch(() => {
    // No listeners open — that is fine.
  });
}

function broadcastTranscriptChunk(payload) {
  chrome.runtime.sendMessage({ type: 'TRANSCRIPT_CHUNK', payload }).catch(() => {
    // Side panel may not be open yet — side panel hydrates via GET_STATE on open.
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

  // chrome.tabCapture.getMediaStreamId must be called in the service worker.
  let streamId;
  try {
    streamId = await new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(id);
        }
      });
    });
  } catch (err) {
    return { success: false, error: `Tab capture failed: ${err.message}` };
  }

  const model = await getPreferredModel();

  await ensureOffscreenDocument();
  await setRecordingTabId(tabId);
  await setSessionState(STATE.RECORDING);

  chrome.runtime.sendMessage({
    type: 'START_RECORDING',
    payload: { streamId, apiKey, model },
  });

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

  chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });

  return { success: true };
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
      handleStartRecording(sender.tab?.id ?? payload?.tabId)
        .then(sendResponse);
      return true;

    case 'STOP_RECORDING':
      handleStopRecording().then(sendResponse);
      return true;

    case 'CLEAR_NOTES':
      clearSessionData()
        .then(() => broadcastState())
        .then(() => closeOffscreenDocument())
        .then(() => sendResponse({ success: true }));
      return true;

    // --- From offscreen document ---

    case 'RECORDING_STARTED':
      broadcastState();
      break;

    case 'TRANSCRIPT_CHUNK':
      // Persist the running full transcript, then relay the chunk to the side panel.
      setLiveTranscript(payload.fullTranscript)
        .then(() => broadcastTranscriptChunk(payload));
      break;

    case 'NOTES_READY':
      // Capture liveTranscript before state mutation, then save session + history together.
      getSessionState().then(({ liveTranscript }) =>
        Promise.all([
          setNotes(payload.notes),
          setFinalTranscript(payload.finalTranscript),
          setSessionState(STATE.DONE),
          appendToHistory({
            id: Date.now().toString(),
            timestamp: Date.now(),
            liveTranscript,
            finalTranscript: payload.finalTranscript,
            notes: payload.notes,
          }),
        ])
      ).then(() => broadcastState());
      break;

    case 'PROCESSING_ERROR':
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
  await closeOffscreenDocument().catch(() => {});
});

// ---------------------------------------------------------------------------
// Toolbar icon — recording dot overlay
// ---------------------------------------------------------------------------

/**
 * Draws the base icon onto an OffscreenCanvas and optionally overlays a
 * red recording dot in the bottom-right corner.
 *
 * Uses OffscreenCanvas which is available in MV3 service workers.
 *
 * @param {boolean} recording - Whether to render the red dot.
 */
async function updateToolbarIcon(recording) {
  const SIZE = 128;
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');

  // Fetch the base icon and draw it.
  const response = await fetch(chrome.runtime.getURL('public/icons/icon128_base.png'));
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  ctx.drawImage(bitmap, 0, 0, SIZE, SIZE);
  bitmap.close();

  if (recording) {
    // Red dot — bottom-right quadrant, 28px radius.
    const cx = SIZE - 26;
    const cy = SIZE - 26;
    const r  = 22;

    // White halo for contrast on any background.
    ctx.beginPath();
    ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill();

    // Red fill.
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#e53e3e';
    ctx.fill();
  }

  const imageData = ctx.getImageData(0, 0, SIZE, SIZE);

  await chrome.action.setIcon({
    imageData: {
      128: imageData,
      // Chrome scales from 128 automatically for smaller sizes.
    },
  });
}

// Listen for state changes to toggle the dot.
chrome.storage.session.onChanged.addListener((changes) => {
  if (!changes.extension_state) return;
  const newState = changes.extension_state.newValue;
  const isRecording = newState === 'RECORDING';
  updateToolbarIcon(isRecording).catch(() => {});
});
