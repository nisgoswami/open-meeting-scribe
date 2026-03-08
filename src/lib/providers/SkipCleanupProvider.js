/**
 * SkipCleanupProvider
 *
 * No-op cleanup provider. Returns the raw transcript unchanged.
 * Useful when the user wants to skip the cleanup step entirely
 * (faster, no API cost, keeps the exact Web Speech API output).
 */

export class SkipCleanupProvider {
  /**
   * @param {string} rawTranscript
   * @returns {Promise<string>}
   */
  async cleanup(rawTranscript) {
    return rawTranscript ?? '';
  }
}
