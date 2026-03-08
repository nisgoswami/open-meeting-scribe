/**
 * SpeechRecognitionManager — wraps the Web Speech API SpeechRecognition interface.
 *
 * Features:
 *   - Auto-restarts on unexpected stop (silence timeout, network glitch, etc.)
 *   - Distinguishes fatal errors (permission denied) from transient ones
 *   - stop() returns a Promise that resolves only after the final `onend` fires,
 *     ensuring all pending result events are delivered before the caller proceeds.
 */
export class SpeechRecognitionManager {
  #recognition = null;
  #shouldRestart = false;
  #stopResolve = null;

  /**
   * @param {(text: string, isFinal: boolean) => void} onResult
   * @param {(error: string, fatal: boolean) => void} onError
   */
  constructor(onResult, onError) {
    this._onResult = onResult;
    this._onError  = onError;
  }

  /** True if the browser supports SpeechRecognition. */
  get isSupported() {
    return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
  }

  /** Start continuous recognition with auto-restart on unexpected stops. */
  start() {
    if (!this.isSupported) {
      this._onError('Web Speech API is not supported in this browser.', true);
      return;
    }
    this.#shouldRestart = true;
    this.#initAndStart();
  }

  /**
   * Gracefully stop recognition.
   * The returned Promise resolves once the engine's final `onend` fires so
   * that all pending result events are captured before the caller proceeds.
   * @returns {Promise<void>}
   */
  stop() {
    this.#shouldRestart = false;
    if (!this.#recognition) return Promise.resolve();
    return new Promise((resolve) => {
      this.#stopResolve = resolve;
      this.#recognition.stop();
    });
  }

  #initAndStart() {
    const SpeechRecognitionAPI =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;

    const r = new SpeechRecognitionAPI();
    r.continuous      = true;
    r.interimResults  = true;
    r.lang            = navigator.language;

    r.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        this._onResult(result[0].transcript, result.isFinal);
      }
    };

    r.onerror = (event) => {
      const error = event.error;
      // 'not-allowed' / 'service-not-allowed' = mic permission denied.
      const fatal = error === 'not-allowed' || error === 'service-not-allowed';
      if (fatal) this.#shouldRestart = false;
      this._onError(`Speech recognition error: ${error}`, fatal);
    };

    r.onend = () => {
      // If stop() was called, resolve its promise.
      if (this.#stopResolve) {
        const resolve = this.#stopResolve;
        this.#stopResolve = null;
        resolve();
        return;
      }
      // Otherwise auto-restart (browser ended due to silence / network glitch).
      if (this.#shouldRestart) {
        setTimeout(() => this.#initAndStart(), 300);
      }
    };

    this.#recognition = r;
    r.start();
  }
}
