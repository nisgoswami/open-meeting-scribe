/**
 * OpenAI integration for Open Meeting Scribe.
 *
 * This module is intentionally thin so that models and endpoints can be
 * swapped without touching business logic.  All API calls use the user's
 * own key — nothing is proxied through a backend.
 *
 * Supported operations:
 *   1. transcribeAudio    — Whisper transcription of a single audio segment.
 *   2. cleanupTranscript  — GPT light-edit pass on the raw joined transcript.
 *   3. summarizeMeeting   — GPT structured meeting notes from cleaned transcript.
 */

const OPENAI_BASE = 'https://api.openai.com/v1';

/**
 * @typedef {Object} MeetingNotes
 * @property {string}   summary          - High-level meeting summary.
 * @property {string[]} key_decisions    - Decisions reached during the meeting.
 * @property {string[]} action_items     - Tasks with owners / due dates if mentioned.
 * @property {string[]} open_questions   - Unresolved questions that need follow-up.
 */

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

/**
 * Transcribes an audio segment using the OpenAI audio transcriptions API.
 * Called once per 10-second segment during live recording.
 *
 * @param {Blob}   audioBlob - A self-contained WebM/Opus audio segment.
 * @param {string} apiKey    - The user's OpenAI API key.
 * @param {string} [model]   - The transcription model to use (default: gpt-realtime-mini).
 * @returns {Promise<string>} The raw transcript text for this segment.
 */
export async function transcribeAudio(audioBlob, apiKey, model = 'gpt-realtime-mini') {
  if (!apiKey) throw new Error('OpenAI API key is required.');

  const formData = new FormData();
  formData.append('file', audioBlob, 'segment.webm');
  formData.append('model', model);
  formData.append('response_format', 'text');

  const response = await fetch(`${OPENAI_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`Transcription API error ${response.status}: ${detail}`);
  }

  return response.text();
}

// ---------------------------------------------------------------------------
// Transcript cleanup
// ---------------------------------------------------------------------------

const CLEANUP_SYSTEM_PROMPT = `You are a professional transcript editor. Clean up the following meeting transcript:
- Fix punctuation and capitalisation
- Remove filler words (um, uh, like, you know) used as verbal fillers
- Add paragraph breaks at natural topic transitions
- Do NOT summarise, remove, or change the meaning of any content
- Do NOT add speaker labels if they are not already present
Return only the cleaned transcript text with no preamble or commentary.`;

/**
 * Runs a light GPT editing pass on the raw joined transcript to produce a
 * clean, readable "Final Transcript" for the side panel.
 *
 * This call is non-fatal: if it fails, the raw transcript is returned as-is
 * so that note generation can still proceed.
 *
 * @param {string} rawTranscript - The full transcript built from all segments.
 * @param {string} apiKey        - The user's OpenAI API key.
 * @param {string} [model]       - GPT model to use (default: gpt-4o-mini).
 * @returns {Promise<string>} Cleaned transcript text.
 */
export async function cleanupTranscript(rawTranscript, apiKey, model = 'gpt-4o-mini') {
  if (!apiKey) throw new Error('OpenAI API key is required.');
  if (!rawTranscript?.trim()) return rawTranscript ?? '';

  try {
    const response = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          { role: 'system', content: CLEANUP_SYSTEM_PROMPT },
          { role: 'user', content: rawTranscript },
        ],
      }),
    });

    if (!response.ok) {
      console.warn(`Transcript cleanup returned ${response.status} — using raw transcript.`);
      return rawTranscript;
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? rawTranscript;
  } catch (err) {
    // Non-fatal: return raw transcript so summarisation can proceed.
    console.warn('Transcript cleanup failed:', err.message);
    return rawTranscript;
  }
}

// ---------------------------------------------------------------------------
// Summarisation
// ---------------------------------------------------------------------------

const SUMMARY_SYSTEM_PROMPT = `You are an expert meeting analyst. Given a meeting transcript, produce a structured JSON object with exactly these four keys:
- "summary": a concise 2-4 sentence overview of the meeting purpose and outcome.
- "key_decisions": an array of strings, each describing a decision that was made.
- "action_items": an array of strings, each describing a task including the owner and deadline where mentioned.
- "open_questions": an array of strings, each describing an unresolved question that needs follow-up.

Respond ONLY with the raw JSON object. No markdown fences, no explanation.`;

/**
 * Generates structured meeting notes from the cleaned transcript.
 *
 * @param {string} transcript - The cleaned transcript text.
 * @param {string} apiKey     - The user's OpenAI API key.
 * @param {string} [model]    - The GPT model to use (default: gpt-4o-mini).
 * @returns {Promise<MeetingNotes>} Structured meeting notes.
 */
export async function summarizeMeeting(transcript, apiKey, model = 'gpt-4o-mini') {
  if (!apiKey) throw new Error('OpenAI API key is required.');
  if (!transcript || transcript.trim().length === 0) {
    throw new Error('Transcript is empty — nothing to summarise.');
  }

  const response = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Here is the meeting transcript:\n\n${transcript}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`OpenAI API error ${response.status}: ${detail}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content;

  if (!raw) throw new Error('OpenAI returned an empty response.');

  try {
    const notes = JSON.parse(raw);
    return validateNotes(notes);
  } catch {
    throw new Error(`Could not parse meeting notes JSON: ${raw.slice(0, 200)}`);
  }
}

/**
 * Validates that the parsed notes object has the expected shape.
 * Fills in missing arrays so callers can rely on the structure.
 *
 * @param {object} notes
 * @returns {MeetingNotes}
 */
function validateNotes(notes) {
  return {
    summary: typeof notes.summary === 'string' ? notes.summary : 'No summary available.',
    key_decisions: Array.isArray(notes.key_decisions) ? notes.key_decisions : [],
    action_items: Array.isArray(notes.action_items) ? notes.action_items : [],
    open_questions: Array.isArray(notes.open_questions) ? notes.open_questions : [],
  };
}
