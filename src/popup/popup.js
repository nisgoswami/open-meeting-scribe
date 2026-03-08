/**
 * Popup Script — Open Meeting Scribe
 *
 * Manages the popup UI state machine and user interactions.
 * All persistent state lives in chrome.storage.session (managed by the
 * service worker); the popup only renders whatever the service worker reports.
 *
 * Views correspond to extension states:
 *   NOT_ON_MEET  → #view-not-on-meet
 *   IDLE         → #view-idle
 *   RECORDING    → #view-recording
 *   PROCESSING   → #view-processing
 *   DONE         → #view-done
 *   ERROR        → #view-error
 */

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const views = {
  notOnMeet:  document.getElementById('view-not-on-meet'),
  idle:       document.getElementById('view-idle'),
  recording:  document.getElementById('view-recording'),
  processing: document.getElementById('view-processing'),
  done:       document.getElementById('view-done'),
  error:      document.getElementById('view-error'),
};

const btnStart      = document.getElementById('btn-start');
const btnStop       = document.getElementById('btn-stop');
const btnCopy       = document.getElementById('btn-copy');
const btnClear      = document.getElementById('btn-clear');
const btnRetry      = document.getElementById('btn-retry');
const settingsLink  = document.getElementById('settings-link');
const btnOpenPanel  = document.getElementById('btn-open-panel');
const timerEl       = document.getElementById('timer');
const toast         = document.getElementById('toast');
const errorMessage  = document.getElementById('error-message');
const notesSummary  = document.getElementById('notes-summary');
const notesDecisions = document.getElementById('notes-decisions');
const notesActions  = document.getElementById('notes-actions');
const notesQuestions = document.getElementById('notes-questions');

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------

let timerInterval = null;
let timerStart = null;

function startTimer() {
  timerStart = Date.now();
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - timerStart) / 1000);
    const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const ss = String(elapsed % 60).padStart(2, '0');
    timerEl.textContent = `${mm}:${ss}`;
  }, 500);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  timerEl.textContent = '00:00';
}

// ---------------------------------------------------------------------------
// View rendering
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

async function render(snapshot) {
  const { state, notes } = snapshot;
  const onMeet = await isOnMeetTab();

  if (!onMeet && state !== 'RECORDING' && state !== 'PROCESSING') {
    stopTimer();
    showView('notOnMeet');
    return;
  }

  switch (state) {
    case 'IDLE':
      stopTimer();
      showView('idle');
      break;

    case 'RECORDING':
      if (!timerInterval) startTimer();
      showView('recording');
      break;

    case 'PROCESSING':
      stopTimer();
      showView('processing');
      break;

    case 'DONE':
      stopTimer();
      if (notes) renderNotes(notes);
      showView('done');
      break;

    case 'ERROR': {
      stopTimer();
      const errRaw = await chrome.storage.session.get('extension_error');
      errorMessage.textContent =
        errRaw.extension_error ?? 'An unexpected error occurred.';
      showView('error');
      break;
    }

    default:
      stopTimer();
      showView('idle');
  }
}

function renderNotes(notes) {
  notesSummary.textContent = notes.summary ?? '';

  renderList(notesDecisions, notes.key_decisions);
  renderList(notesActions, notes.action_items);
  renderList(notesQuestions, notes.open_questions);

  // Hide empty sections gracefully.
  document.getElementById('section-decisions').hidden =
    !notes.key_decisions?.length;
  document.getElementById('section-actions').hidden =
    !notes.action_items?.length;
  document.getElementById('section-questions').hidden =
    !notes.open_questions?.length;
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
// Toast
// ---------------------------------------------------------------------------

let toastTimeout = null;

function showToast(message = 'Copied to clipboard!') {
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.add('hidden'), 2000);
}

// ---------------------------------------------------------------------------
// Notes formatting for clipboard
// ---------------------------------------------------------------------------

async function buildClipboardText() {
  const result = await chrome.storage.session.get('meeting_notes');
  const notes = result.meeting_notes;
  if (!notes) return '';

  const lines = ['# Meeting Notes\n'];

  lines.push('## Summary', notes.summary, '');

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

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

btnStart.addEventListener('click', async () => {
  btnStart.disabled = true;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const response = await chrome.runtime.sendMessage({
    type: 'START_RECORDING',
    payload: { tabId: tab?.id },
  });
  if (!response?.success) {
    btnStart.disabled = false;
    errorMessage.textContent = response?.error ?? 'Could not start recording.';
    showView('error');
  }
});

btnStop.addEventListener('click', async () => {
  btnStop.disabled = true;
  await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
});

btnCopy.addEventListener('click', async () => {
  const text = await buildClipboardText();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  showToast('Copied to clipboard!');
});

btnClear.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'CLEAR_NOTES' });
});

btnRetry.addEventListener('click', async () => {
  await chrome.storage.session.remove('extension_error');
  await chrome.runtime.sendMessage({ type: 'CLEAR_NOTES' });
  showView('idle');
});

btnOpenPanel.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.windowId) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

settingsLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// ---------------------------------------------------------------------------
// Live state updates from service worker
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'STATE_UPDATE') {
    render(message.payload);
  }
});

// ---------------------------------------------------------------------------
// Initialise
// ---------------------------------------------------------------------------

(async () => {
  const snapshot = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  await render(snapshot);
})();
