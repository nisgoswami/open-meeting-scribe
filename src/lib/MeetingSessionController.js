/**
 * MeetingSessionController — orchestrates SpeechRecognitionManager + TranscriptBuffer.
 *
 * Lifecycle:
 *   start()  — clears the buffer and begins recognition
 *   stop()   — stops recognition; returns a Promise<string> with the full final transcript
 *
 * Callbacks supplied at construction:
 *   onUpdate(finalText, interimText)  — fired on every recognition event (for live UI)
 *   onChunk(text, fullTranscript)     — fired on each committed final utterance
 *   onError(message, fatal)           — fired on recognition errors
 */

import { SpeechRecognitionManager } from './SpeechRecognitionManager.js';
import { TranscriptBuffer }         from './TranscriptBuffer.js';

export class MeetingSessionController {
  #manager;
  #buffer;
  #onUpdate;
  #onChunk;
  #onError;

  /**
   * @param {{ onUpdate: Function, onChunk: Function, onError: Function }} options
   */
  constructor({ onUpdate, onChunk, onError }) {
    this.#buffer   = new TranscriptBuffer();
    this.#onUpdate = onUpdate;
    this.#onChunk  = onChunk;
    this.#onError  = onError;

    this.#manager = new SpeechRecognitionManager(
      (text, isFinal) => this.#handleResult(text, isFinal),
      (error, fatal)  => this.#onError(error, fatal),
    );
  }

  /** True if the current browser supports SpeechRecognition. */
  get isSupported() {
    return this.#manager.isSupported;
  }

  /** Clear the buffer and begin recognition. */
  start() {
    this.#buffer.clear();
    this.#manager.start();
  }

  /**
   * Stop recognition and return the accumulated final transcript.
   * @returns {Promise<string>}
   */
  async stop() {
    await this.#manager.stop();
    return this.#buffer.getFinalText();
  }

  // ---------------------------------------------------------------------------

  #handleResult(text, isFinal) {
    if (isFinal) {
      this.#buffer.appendFinal(text);
      const full = this.#buffer.getFinalText();
      this.#onChunk(text, full);
      this.#onUpdate(full, '');
    } else {
      this.#buffer.setInterim(text);
      this.#onUpdate(this.#buffer.getFinalText(), text);
    }
  }
}
