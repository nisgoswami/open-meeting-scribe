/**
 * TranscriptBuffer — in-memory store for live SpeechRecognition results.
 *
 * Separates committed "final" segments from the current "interim" hypothesis
 * so the UI can display both with different styling.
 */
export class TranscriptBuffer {
  #finals = [];
  #interim = '';

  /** Update the current in-progress (interim) hypothesis. */
  setInterim(text) {
    this.#interim = text;
  }

  /** Commit a final utterance and clear the interim slot. */
  appendFinal(text) {
    const trimmed = text.trim();
    if (trimmed) this.#finals.push(trimmed);
    this.#interim = '';
  }

  /** All committed utterances joined into one string. */
  getFinalText() {
    return this.#finals.join(' ');
  }

  /** Final text + current interim hypothesis (for display). */
  getFullText() {
    const base = this.getFinalText();
    return this.#interim ? `${base} ${this.#interim}`.trim() : base;
  }

  /** Reset for a new session. */
  clear() {
    this.#finals = [];
    this.#interim = '';
  }
}
