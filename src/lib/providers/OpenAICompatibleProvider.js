/**
 * OpenAICompatibleProvider
 *
 * Base provider that works with any OpenAI-compatible `/chat/completions`
 * endpoint — covers OpenAI, DeepSeek, LM Studio, Ollama, and custom endpoints.
 *
 * Used directly by ProviderRegistry; concrete provider types are just named
 * configurations (different baseUrl / default model) rather than subclasses.
 *
 * Implements both:
 *   cleanup(rawTranscript)  → Promise<string>        (non-fatal: returns raw on error)
 *   summarize(transcript)   → Promise<MeetingNotes>  (throws on error)
 */

import { CLEANUP_SYSTEM_PROMPT, SUMMARY_SYSTEM_PROMPT } from './prompts.js';

/**
 * @typedef {Object} MeetingNotes
 * @property {string}   summary
 * @property {string[]} key_decisions
 * @property {string[]} action_items
 * @property {string[]} open_questions
 */

export class OpenAICompatibleProvider {
  /** @type {string} */
  #baseUrl;
  /** @type {string|null} */
  #apiKey;
  /** @type {string} */
  #cleanupModel;
  /** @type {string} */
  #summaryModel;

  /**
   * @param {object} options
   * @param {string}      options.baseUrl      - Base URL including path, e.g. "https://api.openai.com/v1"
   * @param {string|null} options.apiKey       - Bearer token; pass null for unauthenticated local servers.
   * @param {string}      options.cleanupModel - Model ID to use for transcript cleanup.
   * @param {string}      options.summaryModel - Model ID to use for meeting summarisation.
   */
  constructor({ baseUrl, apiKey, cleanupModel, summaryModel }) {
    this.#baseUrl       = baseUrl.replace(/\/$/, '');
    this.#apiKey        = apiKey ?? null;
    this.#cleanupModel  = cleanupModel;
    this.#summaryModel  = summaryModel;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Runs a light edit pass on `rawTranscript` to produce a clean final transcript.
   * Non-fatal: if the API call fails, returns `rawTranscript` unchanged.
   *
   * @param {string} rawTranscript
   * @returns {Promise<string>}
   */
  async cleanup(rawTranscript) {
    if (!rawTranscript?.trim()) return rawTranscript ?? '';
    try {
      const content = await this.#chatCompletion(
        this.#cleanupModel,
        CLEANUP_SYSTEM_PROMPT,
        rawTranscript,
        0.1,
        4096,
      );
      return content ?? rawTranscript;
    } catch (err) {
      console.warn(`[OpenAICompatibleProvider] Cleanup failed (${this.#baseUrl}):`, err.message);
      return rawTranscript;
    }
  }

  /**
   * Generates structured meeting notes from the cleaned transcript.
   * Throws on error (fatal — caller should surface this to the user).
   *
   * @param {string} transcript
   * @returns {Promise<MeetingNotes>}
   */
  async summarize(transcript) {
    if (!transcript?.trim()) {
      throw new Error('Transcript is empty — nothing to summarise.');
    }

    const raw = await this.#chatCompletion(
      this.#summaryModel,
      SUMMARY_SYSTEM_PROMPT,
      `Here is the meeting transcript:\n\n${transcript}`,
      0.2,
      1024,
    );

    if (!raw) throw new Error('Provider returned an empty response.');

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Could not parse meeting notes JSON: ${raw.slice(0, 200)}`);
    }

    return {
      summary:        typeof parsed.summary       === 'string' ? parsed.summary       : 'No summary available.',
      key_decisions:  Array.isArray(parsed.key_decisions)      ? parsed.key_decisions  : [],
      action_items:   Array.isArray(parsed.action_items)       ? parsed.action_items   : [],
      open_questions: Array.isArray(parsed.open_questions)     ? parsed.open_questions : [],
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * @param {string} model
   * @param {string} systemPrompt
   * @param {string} userContent
   * @param {number} temperature
   * @param {number} maxTokens
   * @returns {Promise<string|null>} The assistant message content, or null.
   */
  async #chatCompletion(model, systemPrompt, userContent, temperature, maxTokens) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.#apiKey) headers['Authorization'] = `Bearer ${this.#apiKey}`;

    const response = await fetch(`${this.#baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userContent  },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new Error(`API error ${response.status}: ${detail}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? null;
  }
}
