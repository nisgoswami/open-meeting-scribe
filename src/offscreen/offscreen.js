/**
 * Offscreen Document — Open Meeting Scribe
 *
 * Runs as a hidden offscreen document so that MediaRecorder and getUserMedia
 * are available (both are unavailable in MV3 service workers).
 *
 * Recording strategy — segment-based restart loop:
 *   Every SEGMENT_DURATION_MS the active MediaRecorder is stopped and a new
 *   one is immediately started on the same captureStream.  Each stop produces
 *   a self-contained WebM file (its own EBML header + audio data) which
 *   Whisper can transcribe independently.  This avoids the WebM header-sharing
 *   problem that arises when slicing a single continuous recording.
 *
 * Concurrency model:
 *   Multiple Whisper calls can be in-flight simultaneously (one per segment).
 *   Each call captures its own segment index.  Results are stored in
 *   transcriptSegments[] by index so the final join is always in order.
 *   handleFinalProcessing() awaits Promise.allSettled(pendingTranscriptions)
 *   before calling cleanup + summarise, so no segment is ever lost.
 *
 * Audio data lifecycle:
 *   Each segment's Blob is created, sent to Whisper, and then GC-eligible.
 *   No audio accumulates in memory across segments.
 *   API key and all transcript data are cleared in the finally block of
 *   handleFinalProcessing().
 */

import { transcribeAudio, cleanupTranscript, summarizeMeeting } from '../lib/openai.js';

// ---------------------------------------------------------------------------
// Module state — all in-memory, never serialised to storage
// ---------------------------------------------------------------------------

/** True while the user wants segments to keep cycling. */
let isStopRequested = false;

/** @type {MediaStream | null} */
let captureStream = null;

/** @type {AudioContext | null} Pipes the capture stream back to speakers. */
let audioContext = null;

/** @type {MediaRecorder | null} The currently active segment recorder. */
let mediaRecorder = null;

/** Chunks accumulating for the current segment. Spliced atomically in onstop. */
let currentSegmentChunks = [];

/** Monotonically increasing segment counter used for in-order transcript joining. */
let segmentIndex = 0;

/** Transcribed text per segment, indexed by segmentIndex. */
let transcriptSegments = [];

/** In-flight transcription Promises — awaited before final processing. */
let pendingTranscriptions = [];

/** Auto-cycle timer handle. */
let segmentTimer = null;

/** @type {string | null} */
let apiKey = null;

/** @type {string} Model for per-segment live transcription. */
let liveModel = 'gpt-realtime-mini';

/** @type {string} Model for the final transcript cleanup pass. */
let finalModel = 'gpt-4o-transcribe';

/** @type {string} Model for meeting summary generation. */
let summaryModel = 'gpt-5-mini';

const SEGMENT_DURATION_MS = 10_000; // 10 seconds per segment

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type, payload } = message;

  switch (type) {
    case 'START_RECORDING':
      startRecording(payload).then(sendResponse).catch((err) => {
        sendError(err.message);
        sendResponse({ success: false, error: err.message });
      });
      return true;

    case 'STOP_RECORDING':
      stopRecording();
      sendResponse({ success: true });
      break;

    default:
      break;
  }
});

// ---------------------------------------------------------------------------
// Recording start
// ---------------------------------------------------------------------------

async function startRecording({ streamId, apiKey: key, liveModel: lm, finalModel: fm, summaryModel: sm }) {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    throw new Error('Recording already in progress.');
  }

  apiKey = key;
  liveModel   = lm ?? 'gpt-realtime-mini';
  finalModel  = fm ?? 'gpt-4o-transcribe';
  summaryModel = sm ?? 'gpt-5-mini';
  isStopRequested = false;
  transcriptSegments = [];
  pendingTranscriptions = [];
  segmentIndex = 0;

  captureStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  });

  // Pipe captured audio back to speakers so Meet audio isn't silenced.
  audioContext = new AudioContext();
  audioContext.createMediaStreamSource(captureStream).connect(audioContext.destination);

  beginSegment();

  chrome.runtime.sendMessage({ type: 'RECORDING_STARTED' });
  return { success: true };
}

// ---------------------------------------------------------------------------
// Segment lifecycle
// ---------------------------------------------------------------------------

/**
 * Starts a new MediaRecorder segment on the existing captureStream.
 * Schedules an automatic cycle after SEGMENT_DURATION_MS.
 */
function beginSegment() {
  currentSegmentChunks = [];
  const mimeType = getSupportedMimeType();
  mediaRecorder = new MediaRecorder(captureStream, { mimeType });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data?.size > 0) currentSegmentChunks.push(e.data);
  };

  mediaRecorder.onstop = onSegmentStop;

  // 1-second timeslice ensures data flows even if segment is very short.
  mediaRecorder.start(1000);

  segmentTimer = setTimeout(cycleSegment, SEGMENT_DURATION_MS);
}

/** Triggers an automatic mid-recording segment restart. */
function cycleSegment() {
  if (isStopRequested || !mediaRecorder || mediaRecorder.state === 'inactive') return;
  mediaRecorder.stop(); // triggers onSegmentStop → beginSegment (because !isStopRequested)
}

/**
 * Called by the popup/side panel to end the recording.
 * Sets isStopRequested FIRST so the onstop handler routes to final processing.
 */
function stopRecording() {
  // Set flag before clearTimeout to eliminate the timer-vs-stop race condition.
  isStopRequested = true;
  clearTimeout(segmentTimer);
  segmentTimer = null;

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop(); // triggers onSegmentStop with isStopRequested=true
  } else {
    // Edge case: recorder already inactive (e.g. meeting ended mid-segment).
    handleFinalProcessing();
  }
}

// ---------------------------------------------------------------------------
// Segment stop handler
// ---------------------------------------------------------------------------

/**
 * Fired by the MediaRecorder after every segment stop (both auto-cycle and
 * user-initiated).  Dispatches to either beginSegment or handleFinalProcessing.
 */
async function onSegmentStop() {
  // Atomically capture and clear the chunk buffer.
  const chunks = currentSegmentChunks.splice(0);

  // Snapshot the stop flag — it must not change mid-execution.
  const wasFinalStop = isStopRequested;

  if (wasFinalStop) {
    // Release media resources immediately.
    captureStream?.getTracks().forEach((t) => t.stop());
    captureStream = null;
    audioContext?.close();
    audioContext = null;
  } else {
    // Auto-cycle: start the next segment right away to minimise the gap.
    beginSegment();
  }

  // Transcribe this segment asynchronously (does not block the new segment).
  if (chunks.length > 0) {
    const myIndex = segmentIndex++;
    const mimeType = getSupportedMimeType();
    const blob = new Blob(chunks, { type: mimeType });

    const transcriptionPromise = (async () => {
      try {
        const text = await transcribeAudio(blob, apiKey, liveModel);
        if (text?.trim()) {
          transcriptSegments[myIndex] = text.trim();
          // Build running full transcript in order (gaps are skipped by filter).
          const fullTranscript = transcriptSegments.filter(Boolean).join(' ');
          chrome.runtime.sendMessage({
            type: 'TRANSCRIPT_CHUNK',
            payload: { text: text.trim(), fullTranscript, index: myIndex },
          });
        }
      } catch (err) {
        // Non-fatal: a missed segment is a minor UX degradation, not a failure.
        console.warn(`Segment ${myIndex} transcription failed:`, err.message);
      }
    })();

    pendingTranscriptions.push(transcriptionPromise);
  }

  if (wasFinalStop) {
    await handleFinalProcessing();
  }
}

// ---------------------------------------------------------------------------
// Final processing
// ---------------------------------------------------------------------------

async function handleFinalProcessing() {
  try {
    // Wait for every in-flight segment transcription to settle.
    await Promise.allSettled(pendingTranscriptions);

    const rawTranscript = transcriptSegments.filter(Boolean).join(' ').trim();

    // Cleanup pass — returns rawTranscript on failure so summarisation still runs.
    const finalTranscript = rawTranscript
      ? await cleanupTranscript(rawTranscript, apiKey, finalModel)
      : '';

    const notes = await summarizeMeeting(
      finalTranscript || 'No transcript available.',
      apiKey,
      summaryModel
    );

    chrome.runtime.sendMessage({
      type: 'NOTES_READY',
      payload: { notes, finalTranscript },
    });
  } catch (err) {
    sendError(err.message);
  } finally {
    // Scrub all in-memory data regardless of outcome.
    transcriptSegments = [];
    pendingTranscriptions = [];
    currentSegmentChunks = [];
    apiKey = null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSupportedMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

function sendError(error) {
  chrome.runtime.sendMessage({
    type: 'PROCESSING_ERROR',
    payload: { error },
  });
}
