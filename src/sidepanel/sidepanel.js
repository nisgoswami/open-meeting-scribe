/**
 * Side Panel Script — Open Meeting Scribe
 *
 * Persistent sidebar that:
 *   - Drives live transcription via SpeechRecognition (MeetingSessionController)
 *   - Shows a rolling live transcript (final utterances + current interim text)
 *   - Displays tabbed meeting notes after the session ends
 *   - Keeps a history list of all meetings in the current browser session
 *   - Supports multiselect delete of past meetings
 */

import { MeetingSessionController } from '../lib/MeetingSessionController.js';

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const views = {
  notOnMeet:     document.getElementById('view-not-on-meet'),
  idle:          document.getElementById('view-idle'),
  recording:     document.getElementById('view-recording'),
  processing:    document.getElementById('view-processing'),
  done:          document.getElementById('view-done'),
  error:         document.getElementById('view-error'),
  history:       document.getElementById('view-history'),
  historyDetail: document.getElementById('view-history-detail'),
};

const btnStop            = document.getElementById('btn-stop');
const btnCopyAll         = document.getElementById('btn-copy-all');
const btnClear           = document.getElementById('btn-clear');
const btnRetry           = document.getElementById('btn-retry');
const btnHistory         = document.getElementById('btn-history');
const btnHistoryFromDone = document.getElementById('btn-history-from-done');
const btnHistoryBack     = document.getElementById('btn-history-back');
const btnClearHistory    = document.getElementById('btn-clear-history');
const btnHistorySelect   = document.getElementById('btn-history-select');
const btnSelectCancel    = document.getElementById('btn-select-cancel');
const btnDeleteSelected  = document.getElementById('btn-delete-selected');
const btnDetailBack      = document.getElementById('btn-detail-back');
const btnDetailCopy      = document.getElementById('btn-detail-copy');

const timerEl            = document.getElementById('timer');
const toast              = document.getElementById('toast');
const errorMessage       = document.getElementById('error-message');
const historyCountLabel  = document.getElementById('history-count-label');
const selectCountEl      = document.getElementById('select-count');
const histHeaderNormal   = document.getElementById('hist-header-normal');
const histHeaderSelect   = document.getElementById('hist-header-select');

// Live transcript elements
const liveTranscriptEl      = document.getElementById('live-transcript');
const transcribingIndicator = document.getElementById('transcribing-indicator');

// Done view tab elements
const tabBtns        = document.querySelectorAll('.tab-btn');
const doneLiveEl     = document.getElementById('done-live-transcript');
const doneFinalEl    = document.getElementById('done-final-transcript');
const notesSummary   = document.getElementById('notes-summary');
const notesDecisions = document.getElementById('notes-decisions');
const notesActions   = document.getElementById('notes-actions');
const notesQuestions = document.getElementById('notes-questions');

// History list elements
const historyListEl  = document.getElementById('history-list');
const historyEmptyEl = document.getElementById('history-empty');

// History detail tab elements
const histTabBtns        = document.querySelectorAll('.hist-tab-btn');
const detailTitle        = document.getElementById('detail-title');
const histLiveEl         = document.getElementById('hist-live-transcript');
const histFinalEl        = document.getElementById('hist-final-transcript');
const histNotesSummary   = document.getElementById('hist-notes-summary');
const histNotesDecisions = document.getElementById('hist-notes-decisions');
const histNotesActions   = document.getElementById('hist-notes-actions');
const histNotesQuestions = document.getElementById('hist-notes-questions');

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let historyReturnView  = 'idle';
let activeHistoryEntry = null;
let selectionMode      = false;
const selectedIds      = new Set();

// Recognition lifecycle flag — prevents double-starting when multiple
// RECORDING state updates arrive for the same session.
let recognitionActive = false;

// The floating interim <p> element at the bottom of the live transcript.
let interimEl = null;

// ---------------------------------------------------------------------------
// SpeechRecognition controller
// ---------------------------------------------------------------------------

const sessionController = new MeetingSessionController({
  onUpdate: (finalText, interimText) => updateLiveTranscript(finalText, interimText),
  onChunk:  (text, fullTranscript)   => handleTranscriptChunk(text, fullTranscript),
  onError:  (message, fatal)         => handleRecognitionError(message, fatal),
});

function handleTranscriptChunk(text, fullTranscript) {
  // Persist the running transcript in session storage via the service worker.
  // The side panel already updates its own UI directly via appendFinalUtterance.
  chrome.runtime.sendMessage({
    type: 'TRANSCRIPT_CHUNK',
    payload: { text, fullTranscript },
  }).catch(() => {});
}

function handleRecognitionError(message, fatal) {
  console.warn('[SpeechRecognition]', message);
  if (fatal) {
    recognitionActive = false;
    chrome.runtime.sendMessage({
      type: 'RECOGNITION_ERROR',
      payload: { error: message },
    }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------

let timerInterval = null;
let timerStart = null;

function startTimer() {
  if (timerInterval) return;
  timerStart = Date.now();
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - timerStart) / 1000);
    const hh = Math.floor(elapsed / 3600);
    const mm = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
    const ss = String(elapsed % 60).padStart(2, '0');
    timerEl.textContent = hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
  }, 500);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  timerEl.textContent = '00:00';
}

// ---------------------------------------------------------------------------
// View management
// ---------------------------------------------------------------------------

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    el.classList.toggle('hidden', key !== name);
  });
}

async function isOnMeetTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url?.startsWith('https://meet.google.com/') ?? false;
}

// ---------------------------------------------------------------------------
// Live transcript — final utterances + interim
// ---------------------------------------------------------------------------

function clearPlaceholder() {
  liveTranscriptEl.querySelector('.transcript-placeholder')?.remove();
}

function isNearBottom() {
  const el = liveTranscriptEl;
  return el.scrollHeight - el.clientHeight <= el.scrollTop + 60;
}

/**
 * Append a committed final utterance as a permanent <p> element.
 * Temporarily removes the floating interim element so DOM order stays correct,
 * then reattaches it afterwards.
 */
function appendFinalUtterance(text) {
  if (!text?.trim()) return;
  clearPlaceholder();

  if (interimEl?.isConnected) interimEl.remove();

  const shouldScroll = isNearBottom();
  const p = document.createElement('p');
  p.textContent = text.trim();
  liveTranscriptEl.appendChild(p);

  if (interimEl) liveTranscriptEl.appendChild(interimEl);
  if (shouldScroll) liveTranscriptEl.scrollTop = liveTranscriptEl.scrollHeight;
}

/**
 * Called on every recognition event (final or interim).
 * Manages the live interim <p> and the "Listening…" indicator.
 */
function updateLiveTranscript(finalText, interimText) {
  transcribingIndicator.classList.remove('hidden');
  clearTimeout(transcribingIndicator._hideTimer);
  transcribingIndicator._hideTimer = setTimeout(
    () => transcribingIndicator.classList.add('hidden'),
    1500,
  );

  if (interimText) {
    clearPlaceholder();
    if (!interimEl || !interimEl.isConnected) {
      interimEl = document.createElement('p');
      interimEl.className = 'transcript-interim';
      liveTranscriptEl.appendChild(interimEl);
    }
    interimEl.textContent = interimText;
    if (isNearBottom()) liveTranscriptEl.scrollTop = liveTranscriptEl.scrollHeight;
  } else {
    // Final result delivered — remove the interim element.
    if (interimEl?.isConnected) {
      interimEl.remove();
      interimEl = null;
    }
  }
}

/**
 * Hydrate the live transcript area from session storage when the panel
 * (re)opens mid-session.
 */
function hydrateTranscript(fullTranscript) {
  if (!fullTranscript?.trim()) return;
  clearPlaceholder();
  const p = document.createElement('p');
  p.textContent = fullTranscript.trim();
  liveTranscriptEl.appendChild(p);
  liveTranscriptEl.scrollTop = liveTranscriptEl.scrollHeight;
}

// ---------------------------------------------------------------------------
// Render (main state machine)
// ---------------------------------------------------------------------------

async function render(snapshot) {
  const { state, notes, liveTranscript, finalTranscript } = snapshot;
  const onMeet = await isOnMeetTab();

  refreshHistoryCount();

  if (!onMeet && state !== 'RECORDING' && state !== 'PROCESSING') {
    stopTimer();
    showView('notOnMeet');
    return;
  }

  switch (state) {
    case 'IDLE':
      stopTimer();
      if (recognitionActive) {
        recognitionActive = false;
        sessionController.stop().catch(() => {});
      }
      showView('idle');
      break;

    case 'RECORDING':
      startTimer();
      if (!recognitionActive) {
        recognitionActive = true;
        if (!sessionController.isSupported) {
          chrome.runtime.sendMessage({
            type: 'RECOGNITION_ERROR',
            payload: { error: 'Web Speech API is not supported in this browser.' },
          }).catch(() => {});
          recognitionActive = false;
          break;
        }
        sessionController.start();
      }
      // Hydrate from session storage if the panel just (re)opened mid-session.
      if (liveTranscript && liveTranscriptEl.childElementCount === 0) {
        hydrateTranscript(liveTranscript);
      }
      showView('recording');
      break;

    case 'PROCESSING':
      stopTimer();
      showView('processing');
      // Stop recognition and forward the final transcript to the service worker.
      if (recognitionActive) {
        recognitionActive = false;
        sessionController.stop().then((transcript) => {
          chrome.runtime.sendMessage({
            type: 'TRANSCRIPT_READY',
            payload: { transcript },
          }).catch(() => {});
        });
      }
      break;

    case 'DONE':
      stopTimer();
      if (notes) renderDoneView(notes, liveTranscript, finalTranscript);
      showView('done');
      break;

    case 'ERROR': {
      stopTimer();
      if (recognitionActive) {
        recognitionActive = false;
        sessionController.stop().catch(() => {});
      }
      const errRaw = await chrome.storage.session.get('extension_error');
      errorMessage.textContent = errRaw.extension_error ?? 'An unexpected error occurred.';
      showView('error');
      break;
    }

    default:
      stopTimer();
      showView('idle');
  }
}

// ---------------------------------------------------------------------------
// Done view
// ---------------------------------------------------------------------------

function renderDoneView(notes, liveTranscript, finalTranscript) {
  doneLiveEl.textContent  = liveTranscript  || 'No live transcript available.';
  doneFinalEl.textContent = finalTranscript || liveTranscript || 'No transcript available.';

  notesSummary.textContent = notes.summary ?? '';
  renderList(notesDecisions, notes.key_decisions);
  document.getElementById('section-decisions').hidden = !notes.key_decisions?.length;
  renderList(notesActions,   notes.action_items);
  renderList(notesQuestions, notes.open_questions);
  document.getElementById('section-actions').hidden   = !notes.action_items?.length;
  document.getElementById('section-questions').hidden = !notes.open_questions?.length;

  switchTab(tabBtns, document.querySelectorAll('.tab-panel'), 'live');
}

function renderList(listEl, items) {
  listEl.innerHTML = '';
  (items ?? []).forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    listEl.appendChild(li);
  });
}

// ---------------------------------------------------------------------------
// Tab switching (shared by done view and history detail view)
// ---------------------------------------------------------------------------

function switchTab(btnSet, panelSet, targetId) {
  btnSet.forEach((b) => {
    const id = b.dataset.tab ?? b.dataset.htab;
    b.classList.toggle('active', id === targetId);
    b.setAttribute('aria-selected', id === targetId ? 'true' : 'false');
  });
  panelSet.forEach((panel) => {
    const suffix = panel.id.replace(/^(tab|htab)-/, '');
    panel.classList.toggle('hidden', suffix !== targetId);
  });
}

tabBtns.forEach((btn) => {
  btn.addEventListener('click', () =>
    switchTab(tabBtns, document.querySelectorAll('.tab-panel'), btn.dataset.tab),
  );
});

histTabBtns.forEach((btn) => {
  btn.addEventListener('click', () =>
    switchTab(histTabBtns, document.querySelectorAll('.hist-tab-panel'), btn.dataset.htab),
  );
});

// ---------------------------------------------------------------------------
// History storage helpers
// ---------------------------------------------------------------------------

async function getHistory() {
  const result = await chrome.storage.session.get('meeting_history');
  return result.meeting_history ?? [];
}

async function deleteAllHistory() {
  await chrome.storage.session.remove('meeting_history');
}

async function deleteHistoryEntries(ids) {
  const idSet = new Set(ids);
  const history = await getHistory();
  const filtered = history.filter((e) => !idSet.has(e.id));
  await chrome.storage.session.set({ meeting_history: filtered });
}

// ---------------------------------------------------------------------------
// History list rendering
// ---------------------------------------------------------------------------

async function refreshHistoryCount() {
  const history = await getHistory();
  historyCountLabel.textContent = history.length > 0 ? `(${history.length})` : '';
}

async function renderHistoryList() {
  const history = await getHistory();
  historyListEl.innerHTML = '';
  if (history.length === 0) {
    historyEmptyEl.classList.remove('hidden');
  } else {
    historyEmptyEl.classList.add('hidden');
    [...history].reverse().forEach((entry) => {
      historyListEl.appendChild(buildHistoryItem(entry));
    });
  }
}

async function openHistoryView(returnView) {
  historyReturnView = returnView;
  exitSelectionMode();
  await renderHistoryList();
  showView('history');
}

function buildHistoryItem(entry) {
  const item = document.createElement('div');
  item.className = 'history-item';
  item.setAttribute('role', 'listitem');
  item.dataset.id = entry.id;

  const date    = new Date(entry.timestamp);
  const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const preview = entry.notes?.summary
    ? entry.notes.summary.slice(0, 90) + (entry.notes.summary.length > 90 ? '…' : '')
    : '(No summary)';

  item.innerHTML = `
    <div class="history-item-check" aria-hidden="true">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    </div>
    <div class="history-item-content">
      <div class="history-item-header">
        <span class="history-item-date">${escapeHtml(dateStr)}</span>
        <span class="history-item-time">${escapeHtml(timeStr)}</span>
      </div>
      <p class="history-item-preview">${escapeHtml(preview)}</p>
    </div>
  `;

  item.addEventListener('click', () => {
    if (selectionMode) {
      toggleItemSelection(item, entry.id);
    } else {
      openHistoryDetail(entry);
    }
  });

  return item;
}

// ---------------------------------------------------------------------------
// History detail view
// ---------------------------------------------------------------------------

function openHistoryDetail(entry) {
  activeHistoryEntry = entry;

  const date    = new Date(entry.timestamp);
  const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  detailTitle.textContent = `${dateStr}, ${timeStr}`;

  histLiveEl.textContent  = entry.liveTranscript  || 'No live transcript available.';
  histFinalEl.textContent = entry.finalTranscript || entry.liveTranscript || 'No transcript available.';

  const notes = entry.notes ?? {};
  histNotesSummary.textContent = notes.summary ?? '';
  renderList(histNotesDecisions, notes.key_decisions);
  document.getElementById('hist-section-decisions').hidden = !notes.key_decisions?.length;
  renderList(histNotesActions,   notes.action_items);
  renderList(histNotesQuestions, notes.open_questions);
  document.getElementById('hist-section-actions').hidden   = !notes.action_items?.length;
  document.getElementById('hist-section-questions').hidden = !notes.open_questions?.length;

  switchTab(histTabBtns, document.querySelectorAll('.hist-tab-panel'), 'live');
  showView('historyDetail');
}

// ---------------------------------------------------------------------------
// Selection mode
// ---------------------------------------------------------------------------

function enterSelectionMode() {
  selectionMode = true;
  selectedIds.clear();
  histHeaderNormal.classList.add('hidden');
  histHeaderSelect.classList.remove('hidden');
  historyListEl.classList.add('selecting');
  updateSelectCount();
}

function exitSelectionMode() {
  selectionMode = false;
  selectedIds.clear();
  histHeaderNormal.classList.remove('hidden');
  histHeaderSelect.classList.add('hidden');
  historyListEl.classList.remove('selecting');
  historyListEl.querySelectorAll('.history-item.selected').forEach((el) =>
    el.classList.remove('selected'),
  );
}

function toggleItemSelection(itemEl, id) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
    itemEl.classList.remove('selected');
  } else {
    selectedIds.add(id);
    itemEl.classList.add('selected');
  }
  updateSelectCount();
}

function updateSelectCount() {
  const n = selectedIds.size;
  selectCountEl.textContent     = n === 1 ? '1 selected' : `${n} selected`;
  btnDeleteSelected.disabled    = n === 0;
  btnDeleteSelected.textContent = n > 0 ? `Delete (${n})` : 'Delete';
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

let toastTimer = null;

function showToast(msg = 'Copied!') {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 2000);
}

// ---------------------------------------------------------------------------
// Clipboard helpers
// ---------------------------------------------------------------------------

async function buildClipboardText() {
  const snap = await chrome.storage.session.get([
    'meeting_notes', 'live_transcript', 'final_transcript',
  ]);
  return formatNotesForClipboard(
    snap.meeting_notes,
    snap.final_transcript || snap.live_transcript || '',
  );
}

function buildClipboardTextFromEntry(entry) {
  return formatNotesForClipboard(
    entry.notes,
    entry.finalTranscript || entry.liveTranscript || '',
  );
}

function formatNotesForClipboard(notes, transcript) {
  const lines = ['# Meeting Notes\n'];
  if (transcript) lines.push('## Full Transcript', transcript, '');
  if (notes) {
    if (notes.summary) lines.push('## Summary', notes.summary, '');
    if (notes.key_decisions?.length) {
      lines.push('## Key Decisions');
      notes.key_decisions.forEach((d) => lines.push(`- ${d}`));
      lines.push('');
    }
    if (notes.action_items?.length) {
      lines.push('## Action Items');
      notes.action_items.forEach((a) => lines.push(`- ${a}`));
      lines.push('');
    }
    if (notes.open_questions?.length) {
      lines.push('## Open Questions');
      notes.open_questions.forEach((q) => lines.push(`- ${q}`));
      lines.push('');
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

btnStop.addEventListener('click', async () => {
  btnStop.disabled = true;
  await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
});

btnCopyAll.addEventListener('click', async () => {
  const text = await buildClipboardText();
  if (!text.trim()) return;
  await navigator.clipboard.writeText(text);
  showToast('Copied!');
});

btnClear.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'CLEAR_NOTES' });
  liveTranscriptEl.innerHTML =
    '<p class="transcript-placeholder">Transcript will appear here as you speak…</p>';
  interimEl = null;
});

btnRetry.addEventListener('click', async () => {
  await chrome.storage.session.remove('extension_error');
  await chrome.runtime.sendMessage({ type: 'CLEAR_NOTES' });
});

// History navigation
btnHistory.addEventListener('click', () => openHistoryView('idle'));
btnHistoryFromDone.addEventListener('click', () => openHistoryView('done'));
btnHistoryBack.addEventListener('click', () => showView(historyReturnView));

// Selection mode controls
btnHistorySelect.addEventListener('click', enterSelectionMode);
btnSelectCancel.addEventListener('click', exitSelectionMode);

btnDeleteSelected.addEventListener('click', async () => {
  if (selectedIds.size === 0) return;
  await deleteHistoryEntries([...selectedIds]);
  exitSelectionMode();
  await renderHistoryList();
  refreshHistoryCount();
});

// Clear all history
btnClearHistory.addEventListener('click', async () => {
  await deleteAllHistory();
  historyListEl.innerHTML = '';
  historyEmptyEl.classList.remove('hidden');
  refreshHistoryCount();
});

// History detail
btnDetailBack.addEventListener('click', () => showView('history'));

btnDetailCopy.addEventListener('click', async () => {
  if (!activeHistoryEntry) return;
  const text = buildClipboardTextFromEntry(activeHistoryEntry);
  await navigator.clipboard.writeText(text);
  showToast('Copied!');
});

// ---------------------------------------------------------------------------
// Incoming messages from service worker
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message) => {
  const { type, payload } = message;
  if (type === 'STATE_UPDATE') {
    render(payload);
  }
});

// ---------------------------------------------------------------------------
// Initialise
// ---------------------------------------------------------------------------

(async () => {
  const snapshot = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  await render(snapshot);
})();
