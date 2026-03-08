/**
 * TranscriptSourceManager
 *
 * Coordinates between two live-transcript sources:
 *
 *   1. Meet Captions  (experimental) — DOM-scraped text from MeetCaptionObserver
 *   2. Speech Recognition (fallback) — browser-native SpeechRecognition via
 *                                      MeetingSessionController
 *
 * State machine:
 *
 *   idle
 *     │ start() called
 *     ▼
 *   detecting  ─── first CAPTION_UPDATE ──► captions
 *     │                                          │
 *     │ 8 s timeout OR CAPTION_STATUS(inactive)  │ CAPTION_STATUS(inactive)
 *     ▼                                          │ OR stale (15 s)
 *   speech_fallback ◄──────────────────────────┘
 *
 *   (When use_meet_captions=false, start() goes directly to state=speech.)
 *
 * Fallback is transparent: the transcript accumulator is shared between both
 * sources so switching mid-session never loses captured text.
 *
 * Callbacks (set via constructor):
 *   onUpdate(finalText, interimText)   — update the live transcript UI
 *   onChunk(text, fullTranscript)      — new final utterance committed
 *   onError(message, fatal)            — recognition error
 *   onSourceChange(source, message)    — transcript source changed
 *     source values: 'detecting' | 'captions' | 'speech' | 'speech_fallback'
 */

import { MeetingSessionController } from './MeetingSessionController.js';
import { getUseMeetCaptions }        from './storage.js';

// How long to wait for captions before switching to speech recognition.
const CAPTION_DETECTION_TIMEOUT_MS = 8_000;

export class TranscriptSourceManager {
  // ── Callbacks ──────────────────────────────────────────────────────────────
  #onUpdate;
  #onChunk;
  #onError;
  #onSourceChange;

  // ── Configuration ──────────────────────────────────────────────────────────
  /** Whether the experimental Meet captions path is enabled (read at start()). */
  #useCaptions = false;

  // ── Transcript accumulator ─────────────────────────────────────────────────
  /** Committed final utterances, in order, from any source. */
  #finalChunks = [];

  // ── Source state ───────────────────────────────────────────────────────────
  /** Current source state (see JSDoc above). */
  #state = 'idle';

  /** Active SpeechRecognition controller (null when using captions). */
  #speechController = null;

  /** Timer that triggers speech-recognition fallback if no captions arrive. */
  #detectionTimer = null;

  /** Epoch ms of the last received caption update (for stale detection). */
  #lastCaptionTime = 0;

  // ---------------------------------------------------------------------------

  constructor({ onUpdate, onChunk, onError, onSourceChange }) {
    this.#onUpdate       = onUpdate;
    this.#onChunk        = onChunk;
    this.#onError        = onError;
    this.#onSourceChange = onSourceChange;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** True if the browser supports SpeechRecognition (used for unsupported-browser guard). */
  get isSupported() {
    return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
  }

  /**
   * Read settings and begin transcription.
   * Must be called once per session (before any handleCaption* calls).
   */
  async start() {
    this.#finalChunks = [];
    this.#useCaptions = await getUseMeetCaptions();

    if (!this.#useCaptions) {
      this.#transitionTo('speech');
      this.#startSpeechController();
      return;
    }

    // Caption mode: start in detecting state and arm the fallback timer.
    this.#transitionTo('detecting');

    this.#detectionTimer = setTimeout(() => {
      if (this.#state === 'detecting') {
        this.#activateSpeechFallback(
          'Meet captions not detected. Switched to speech recognition.',
        );
      }
    }, CAPTION_DETECTION_TIMEOUT_MS);
  }

  /**
   * Stop transcription and return the full final transcript.
   * @returns {Promise<string>}
   */
  async stop() {
    clearTimeout(this.#detectionTimer);
    if (this.#speechController) {
      await this.#speechController.stop().catch(() => {});
      this.#speechController = null;
    }
    return this.#getFinalText();
  }

  /**
   * Handle a CAPTION_UPDATE message from the content script.
   * Called by the side panel after filtering by recording-tab ID.
   *
   * @param {{ text: string, speaker: string, isFinal: boolean }} payload
   */
  handleCaptionUpdate({ text, speaker, isFinal }) {
    if (this.#state === 'detecting') {
      // First caption received — switch from detecting to captions mode.
      clearTimeout(this.#detectionTimer);
      this.#transitionTo('captions', 'Meet captions active.');
    }

    if (this.#state !== 'captions') return;

    this.#lastCaptionTime = Date.now();
    const display = speaker ? `${speaker}: ${text}` : text;

    if (isFinal) {
      this.#commitChunk(display);
    } else {
      // Interim — update the live UI without adding to the accumulator.
      this.#onUpdate(this.#getFinalText(), display);
    }
  }

  /**
   * Handle a CAPTION_STATUS message from the content script.
   * Called by the side panel after filtering by recording-tab ID.
   *
   * @param {{ active: boolean, reason: string }} payload
   */
  handleCaptionStatus({ active, reason }) {
    if (active) return; // positive status doesn't require any action

    if (this.#state === 'detecting') {
      this.#activateSpeechFallback(
        `Meet captions unavailable. Switched to speech recognition. (${reason})`,
      );
    } else if (this.#state === 'captions') {
      this.#activateSpeechFallback(
        `Meet captions stopped. Switched to speech recognition. (${reason})`,
      );
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  #transitionTo(source, message) {
    this.#state = source;
    this.#onSourceChange(source, message ?? null);
  }

  #getFinalText() {
    return this.#finalChunks.join(' ');
  }

  #commitChunk(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.#finalChunks.push(trimmed);
    const full = this.#getFinalText();
    this.#onChunk(trimmed, full);
    this.#onUpdate(full, '');
  }

  /** Switch to (or fall back to) the SpeechRecognition source. */
  #activateSpeechFallback(reason) {
    clearTimeout(this.#detectionTimer);

    // Determine correct state label depending on whether we ever had captions.
    const newState = this.#state === 'captions' ? 'speech_fallback' : 'speech_fallback';
    this.#transitionTo(newState, reason);

    this.#startSpeechController();
  }

  #startSpeechController() {
    if (this.#speechController) return; // already running

    this.#speechController = new MeetingSessionController({
      onUpdate: (finalText, interimText) => {
        // Replace the SR's internal finalText with our unified accumulator.
        this.#onUpdate(this.#getFinalText(), interimText);
      },
      onChunk: (text) => {
        this.#commitChunk(text);
      },
      onError: (message, fatal) => {
        this.#onError(message, fatal);
      },
    });

    if (!this.isSupported) {
      this.#onError('Web Speech API is not supported in this browser.', true);
      return;
    }

    this.#speechController.start();
  }
}
