/**
 * Meet Caption Observer — Content Script
 * Runs on https://meet.google.com/* pages.
 *
 * Observes Google Meet's rendered caption DOM and streams caption updates to
 * the extension via chrome.runtime.sendMessage.
 *
 * ⚠  EXPERIMENTAL — May break if Google Meet changes its DOM structure.
 *    The extension falls back automatically to speech recognition when this
 *    observer cannot locate or read the caption container.
 *
 * Messages sent to the extension:
 *   CAPTION_UPDATE  { text, speaker, isFinal }  — new caption text
 *   CAPTION_STATUS  { active, reason }           — observer active/inactive
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Selector strategy
  //
  // These selectors are tried in priority order.  Meet uses obfuscated CSS
  // class names that change with each deployment, so we maintain a list of
  // historically-observed candidates alongside a positional fallback.
  // ---------------------------------------------------------------------------

  /** Caption container selectors (tried in order, most-specific first). */
  const CONTAINER_SELECTORS = [
    // 2024+ Meet UI — data-attribute-based (most stable)
    '[data-is-active-speaker="true"]',
    // JSName-based selectors — semi-stable
    '[jsname="tgaKEf"]',
    // Historical class-based selectors
    '.a4cQT',
    '.VbkSUe',
    '.HlGDVe',
  ];

  /** Speaker name selectors (tried in order within the caption container). */
  const SPEAKER_SELECTORS = [
    '[data-sender-name]',
    '.nMcdL',
    '[jsname="r4nke"]',
    '[data-participant-id] span',
  ];

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** The currently-observed caption container element (if any). */
  let captionContainer = null;

  /** MutationObserver watching the caption container. */
  let containerObserver = null;

  /** MutationObserver watching document.body for the container to appear. */
  let rootObserver = null;

  /** Timer that commits the current partial utterance as a final result. */
  let commitTimer = null;

  /** Timer that detects when no new caption updates have arrived for a while. */
  let staleTimer = null;

  /** Timer that gives up searching for a container after N seconds. */
  let notFoundTimer = null;

  /** The caption text seen in the most recent DOM observation. */
  let currentText = '';

  /** The speaker seen in the most recent DOM observation. */
  let currentSpeaker = '';

  /** The last text that was sent as a final (committed) result. */
  let lastCommittedText = '';

  /** Epoch ms of the last time we observed any caption activity. */
  let lastActivityTime = 0;

  /** Whether this observer is currently running. */
  let running = false;

  // ---------------------------------------------------------------------------
  // Messaging helpers
  // ---------------------------------------------------------------------------

  function sendUpdate(text, speaker, isFinal) {
    if (!text) return;
    try {
      chrome.runtime.sendMessage({
        type: 'CAPTION_UPDATE',
        payload: { text, speaker, isFinal },
      });
    } catch (_) {
      // Extension context may have been invalidated (page navigated away, etc.)
    }
  }

  function sendStatus(active, reason) {
    try {
      chrome.runtime.sendMessage({
        type: 'CAPTION_STATUS',
        payload: { active, reason },
      });
    } catch (_) {
      // Ignore
    }
  }

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------

  /** Try every known selector; fall back to a positional aria-live search. */
  function findCaptionContainer() {
    for (const sel of CONTAINER_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }

    // Positional fallback: aria-live regions in the lower 40 % of the viewport
    // are likely to be captions.
    const candidates = document.querySelectorAll('[aria-live]');
    for (const el of candidates) {
      try {
        const rect = el.getBoundingClientRect();
        if (
          rect.top > window.innerHeight * 0.55 &&
          rect.width > 80 &&
          el.textContent.trim().length > 0
        ) {
          return el;
        }
      } catch (_) {
        // getBoundingClientRect can throw in detached-DOM edge cases
      }
    }
    return null;
  }

  /**
   * Extract the human-readable caption text and an optional speaker name
   * from the container element.
   */
  function extractFromContainer(container) {
    let speaker = '';
    for (const sel of SPEAKER_SELECTORS) {
      const el = container.querySelector(sel);
      const raw = el?.textContent?.trim();
      if (raw) {
        speaker = raw.replace(/:$/, '').trim();
        break;
      }
    }

    // textContent gives us everything including the speaker prefix.
    // We keep it simple — the caller can format "Speaker: text" if needed.
    const text = container.textContent.trim();
    return { text, speaker };
  }

  // ---------------------------------------------------------------------------
  // Caption processing
  // ---------------------------------------------------------------------------

  function onContainerMutation() {
    if (!captionContainer) return;

    let text, speaker;
    try {
      ({ text, speaker } = extractFromContainer(captionContainer));
    } catch (err) {
      console.warn('[MeetCaptionObserver] extraction error:', err);
      sendStatus(false, `Extraction error: ${err.message}`);
      teardownContainerObserver();
      return;
    }

    if (!text) return;
    if (text === currentText) return;

    lastActivityTime = Date.now();
    currentText = text;
    currentSpeaker = speaker;

    // Send as interim — the text is still growing while the speaker is talking.
    sendUpdate(text, speaker, false);

    // After 1.5 s of no changes, commit as a final utterance.
    clearTimeout(commitTimer);
    commitTimer = setTimeout(() => {
      if (currentText && currentText !== lastCommittedText) {
        sendUpdate(currentText, currentSpeaker, true);
        lastCommittedText = currentText;
        currentText = '';
        currentSpeaker = '';
      }
    }, 1500);
  }

  // ---------------------------------------------------------------------------
  // Container lifecycle
  // ---------------------------------------------------------------------------

  function attachToContainer(container) {
    teardownContainerObserver();
    captionContainer = container;
    containerObserver = new MutationObserver(onContainerMutation);
    containerObserver.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    sendStatus(true, 'Caption container attached');
    onContainerMutation(); // read whatever text is already visible
  }

  function teardownContainerObserver() {
    containerObserver?.disconnect();
    containerObserver = null;
    captionContainer = null;
  }

  function tryFindAndAttach() {
    if (captionContainer) return; // already attached
    const container = findCaptionContainer();
    if (container) {
      clearTimeout(notFoundTimer);
      attachToContainer(container);
    }
  }

  // ---------------------------------------------------------------------------
  // Stale detection
  //
  // If the observer is attached but no text has changed for 15 seconds, report
  // captions as inactive so the side panel can fall back to speech recognition.
  // ---------------------------------------------------------------------------

  function startStaleDetection() {
    staleTimer = setInterval(() => {
      if (lastActivityTime > 0 && Date.now() - lastActivityTime > 15_000) {
        lastActivityTime = 0; // reset so we only fire once per silence window
        sendStatus(false, 'No caption activity for 15 s');
      }
    }, 5_000);
  }

  // ---------------------------------------------------------------------------
  // Boot / teardown
  // ---------------------------------------------------------------------------

  function start() {
    if (running) return;
    running = true;

    tryFindAndAttach();

    // Watch for the caption container to appear — Meet renders it dynamically.
    rootObserver = new MutationObserver(() => {
      if (!captionContainer) tryFindAndAttach();
    });
    rootObserver.observe(document.body, { childList: true, subtree: true });

    startStaleDetection();

    // If no container is found within 5 s, report so TranscriptSourceManager
    // can start the speech-recognition fallback faster than its own 8 s timer.
    notFoundTimer = setTimeout(() => {
      if (!captionContainer) {
        sendStatus(false, 'Caption container not found after 5 s');
      }
    }, 5_000);
  }

  function stop() {
    if (!running) return;
    running = false;
    clearTimeout(commitTimer);
    clearTimeout(notFoundTimer);
    clearInterval(staleTimer);
    teardownContainerObserver();
    rootObserver?.disconnect();
    rootObserver = null;
    sendStatus(false, 'Observer stopped');
  }

  // ---------------------------------------------------------------------------
  // Message listener — service worker can explicitly start/stop the observer.
  // ---------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'START_CAPTION_OBSERVER') start();
    if (message.type === 'STOP_CAPTION_OBSERVER') stop();
  });

  // Auto-start.  The side panel filters updates by recording-tab ID so messages
  // sent when no recording is active are silently discarded.
  start();
})();
