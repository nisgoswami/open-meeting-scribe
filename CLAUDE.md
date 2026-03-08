# CLAUDE.md — Open Meeting Scribe

> This file is the primary reference for Claude agents operating inside this
> repository.  Read it in full before making any changes.  Every section is
> intentional; do not remove or truncate it.

---

## Project Overview

**Open Meeting Scribe** is a Manifest V3 Chrome extension for Google Meet.
It captures tab audio during a meeting, transcribes it with OpenAI Whisper,
and generates structured meeting notes using a GPT model.

Key constraints:
- No backend service — all processing happens in the user's browser or via
  direct calls to the OpenAI API.
- No persistence — meeting audio never touches disk.  Session data lives only
  in `chrome.storage.session` (in-memory) and is cleared after notes are dismissed.
- User-supplied API key — the extension ships with no credentials.
- Chrome Web Store compliant — minimal permissions, no remote code execution.

---

## Architecture Overview

```
┌──────────────────────────────────────────────┐
│  Chrome Extension                            │
│                                              │
│  ┌──────────┐        ┌───────────────────┐   │
│  │  Popup   │◄──────►│  Service Worker   │   │
│  │ (popup/) │        │ (background/)     │   │
│  └──────────┘        └────────┬──────────┘   │
│                               │              │
│  ┌──────────┐        ┌────────▼──────────┐   │
│  │ Options  │        │ Offscreen Document│   │
│  │(options/)│        │  (offscreen/)     │   │
│  └──────────┘        └───────────────────┘   │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │  Shared Lib (lib/)                   │    │
│  │  openai.js · storage.js              │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
            │ direct fetch
            ▼
      OpenAI API
   (Whisper + GPT-4o)
```

### Components

| Component | File(s) | Role |
|-----------|---------|------|
| Service Worker | `src/background/service-worker.js` | State machine, message routing, tab capture coordination |
| Offscreen Document | `src/offscreen/offscreen.{html,js}` | MediaRecorder, audio buffering, OpenAI API calls |
| Popup | `src/popup/popup.{html,js,css}` | User interface, state display, note rendering |
| Options | `src/options/options.{html,js,css}` | API key management, model selection |
| OpenAI Lib | `src/lib/openai.js` | Whisper transcription + GPT summarisation |
| Storage Lib | `src/lib/storage.js` | Typed wrappers for all chrome.storage access |
| Manifest | `manifest.json` | Extension metadata and permission declarations |

---

## Agent Definitions

The following agents simulate an engineering team.  When Claude operates in
this repository, it should identify the appropriate agent role before making
changes and follow that agent's conventions.

### Architecture Agent
**Triggers:** Changes to `manifest.json`, new component proposals, refactors
that span multiple files, permission changes.

**Responsibilities:**
- Design and review the overall component topology.
- Define and enforce the message protocol between components.
- Ensure Manifest V3 best practices (no persistent background pages, no
  remote scripts, minimal permissions).
- Decide the lifecycle of recording sessions (start → record → stop →
  process → display → clear).
- Review any change that adds a new `chrome.*` API usage.

**Conventions:**
- Always check Chrome compatibility tables before using new APIs.
- Prefer `chrome.storage.session` over in-memory variables in the service
  worker (workers can be terminated and restarted).
- Offscreen documents must be closed when not needed to save memory.

---

### Chrome Extension Engineer
**Triggers:** Changes to `service-worker.js`, message passing code,
`manifest.json` permissions, offscreen document lifecycle.

**Responsibilities:**
- Implement and maintain the background service worker.
- Implement tab capture using `chrome.tabCapture.getMediaStreamId()`.
- Manage the offscreen document create/close lifecycle.
- Route all messages between popup ↔ service worker ↔ offscreen.
- Handle extension reload and update gracefully (clear stale state on install).
- Prevent duplicate recordings (guard against multiple START_RECORDING calls).

**Message protocol** (all messages have a `type: string` field):

```
Popup / Side Panel → Service Worker:
  GET_STATE         {}
  START_RECORDING   { tabId?: number }
  STOP_RECORDING    {}
  CLEAR_NOTES       {}

Service Worker → Offscreen:
  START_RECORDING   { streamId, apiKey, model }
  STOP_RECORDING    {}

Offscreen → Service Worker:
  RECORDING_STARTED {}
  TRANSCRIPT_CHUNK  { text: string, fullTranscript: string, index: number }
  NOTES_READY       { notes: MeetingNotes, finalTranscript: string }
  PROCESSING_ERROR  { error: string }

Service Worker → All contexts (broadcast):
  STATE_UPDATE      { state, notes, recordingTabId, liveTranscript, finalTranscript }
  TRANSCRIPT_CHUNK  { text, fullTranscript, index }  ← relayed immediately to side panel
```

---

### Audio Pipeline Engineer
**Triggers:** Changes to `src/offscreen/offscreen.js`, MediaRecorder
configuration, audio chunking logic.

**Responsibilities:**
- Capture tab audio using the stream ID received from the service worker.
- Configure `MediaRecorder` with the best available MIME type (prefer
  `audio/webm;codecs=opus`).
- Collect data chunks every 5 seconds to bound memory usage.
- On stop: merge all chunks into a single `Blob` and pass it directly to the
  OpenAI integration layer.
- Release `MediaStream` tracks and null all audio references immediately
  after the Blob is handed off.

**Key invariants:**
- Audio data must never leave `offscreen.js` as a transferable message.
  Large audio Blobs must NOT be sent through `chrome.runtime.sendMessage`.
- The offscreen document makes the OpenAI API calls directly to avoid
  transferring large payloads.
- `audioChunks`, `captureStream`, `mediaRecorder`, and `apiKey` must all be
  nulled / cleared after processing.

---

### OpenAI Integration Engineer
**Triggers:** Changes to `src/lib/openai.js`, model changes, prompt changes.

**Responsibilities:**
- Implement `transcribeAudio(blob, apiKey)` — calls Whisper (`whisper-1`).
- Implement `summarizeMeeting(transcript, apiKey, model)` — calls GPT.
- Maintain the system prompt that structures output into exactly four keys:
  `summary`, `key_decisions`, `action_items`, `open_questions`.
- Validate and normalise the JSON response (fill missing arrays).
- Surface clear error messages for API key failures, quota exhaustion, and
  malformed responses.

**Modularity rule:** Models and endpoints are referenced only in `openai.js`.
Callers must not hardcode model names or API URLs.

**Prompt stability:** Only change the system prompt after reviewing its
impact on the output schema, as downstream components depend on the exact
JSON keys.

---

### Frontend UX Engineer
**Triggers:** Changes to `src/popup/`, `src/options/`.

**Responsibilities:**
- Render exactly one view per extension state (state machine, not flags).
- Support both light and dark mode via `prefers-color-scheme`.
- Display a live recording timer in the `RECORDING` state.
- Render notes with clear section headings (Summary, Key Decisions, Action
  Items, Open Questions).
- Provide Copy and Clear buttons; show a toast on copy success.
- Keep the popup width at 360px.
- The settings page must mask the API key by default (type="password").
- Validate the API key format before saving; provide inline feedback.

**Accessibility checklist:**
- All interactive elements have accessible labels.
- Status messages use `aria-live`.
- Icons are `aria-hidden`.
- Color is never the sole means of conveying information.

---

### Security and Privacy Engineer
**Triggers:** Any change that touches API key handling, audio data flow,
permissions, or `chrome.storage` usage.

**Responsibilities:**
- Verify that audio blobs are never passed through `chrome.runtime.sendMessage`
  (size limit risk AND data exposure risk).
- Verify that API keys are stored only in `chrome.storage.local` (encrypted
  at rest by Chrome).
- Verify that `chrome.storage.session` is used for all ephemeral state.
- Ensure `clearSessionData()` is called in all terminal states (CLEAR_NOTES,
  error recovery, extension reload).
- Review any new `host_permissions` or `permissions` additions.
- Ensure `content_security_policy` in the manifest disallows `unsafe-eval`
  and remote scripts.

**Non-negotiable rules:**
1. No audio or transcripts are ever written to `chrome.storage.local`.
2. The API key is never logged or included in error messages sent to the UI.
3. No telemetry, analytics, or third-party scripts.

---

### Open Source Maintainer
**Triggers:** Changes to `README.md`, `SECURITY.md`, `LICENSE`, `CLAUDE.md`,
`package.json` (version bumps), release tagging.

**Responsibilities:**
- Keep README accurate and up to date with the actual implementation.
- Update `CLAUDE.md` whenever architecture decisions change.
- Maintain `SECURITY.md` with a responsible disclosure policy.
- Ensure `LICENSE` (MIT) is present and correctly dated.
- Review `package.json` for unnecessarily broad dev dependencies.
- Tag releases with semantic versions matching `manifest.json`.

---

## Development Workflow

### How agents collaborate

When a task spans multiple agents, the recommended sequence is:

1. **Architecture Agent** reviews the scope and approves the design.
2. **Chrome Extension Engineer** or relevant specialist implements the change.
3. **Security and Privacy Engineer** reviews any change involving data flow
   or permissions.
4. **Frontend UX Engineer** reviews any change that affects UI state.
5. **Open Source Maintainer** updates documentation to match.

For single-file changes (e.g., tweaking a prompt in `openai.js`), only the
relevant agent needs to act.

### Branch / commit conventions

- Branch names: `feat/<description>`, `fix/<description>`, `docs/<description>`
- Commit messages: imperative mood, present tense, ≤ 72 chars in subject line.
- Never commit API keys, audio files, or `.zip` packages.

### Testing locally

```bash
node scripts/generate-icons.js   # Generate PNG icons (first time only)
# Then in Chrome:
#   chrome://extensions → Enable Developer mode → Load unpacked → select repo root
```

---

## Codebase Map

```
open-meeting-scribe/
│
├── manifest.json                  Extension manifest (MV3)
│
├── src/
│   ├── background/
│   │   └── service-worker.js      Central coordinator; state machine; message bus
│   │
│   ├── offscreen/
│   │   ├── offscreen.html         Offscreen document entry point
│   │   └── offscreen.js           MediaRecorder; audio buffering; OpenAI calls
│   │
│   ├── popup/
│   │   ├── popup.html             Popup markup; one div per state; "View Live Transcript" button
│   │   ├── popup.js               State rendering; button handlers; timer; sidePanel.open()
│   │   └── popup.css              Styles; dark/light theme
│   │
│   ├── sidepanel/
│   │   ├── sidepanel.html         Side panel markup; recording + 4-tab done views
│   │   ├── sidepanel.js           Live transcript rendering; tab switching; hydration on open
│   │   └── sidepanel.css          Full-height side panel styles; dark/light theme
│   │
│   ├── options/
│   │   ├── options.html           Settings page markup
│   │   ├── options.js             API key save/load; model preference
│   │   └── options.css            Settings page styles
│   │
│   └── lib/
│       ├── openai.js              transcribeAudio() + cleanupTranscript() + summarizeMeeting()
│       └── storage.js             chrome.storage wrappers; STORAGE_KEYS (inc. LIVE/FINAL_TRANSCRIPT)
│
├── public/
│   └── icons/
│       ├── icon.svg               Master icon (source of truth)
│       ├── icon16.png             Generated by scripts/generate-icons.js
│       ├── icon32.png
│       ├── icon48.png
│       └── icon128.png
│
├── scripts/
│   ├── generate-icons.js          Generates PNG icons from SVG
│   └── package.js                 Creates dist/ ZIP for Web Store upload
│
├── CLAUDE.md                      This file
├── README.md                      User-facing documentation
├── SECURITY.md                    Responsible disclosure policy
├── LICENSE                        MIT License
├── package.json                   Dev scripts and optional deps
└── .gitignore
```

---

## Extension Lifecycle

### Recording session lifecycle

```
[User opens popup on meet.google.com]
        │
        ▼
   State: IDLE
        │
        │ User clicks "Start Meeting Notes"
        ▼
   Popup → SW: START_RECORDING
   SW: chrome.tabCapture.getMediaStreamId(tabId) → streamId
   SW: chrome.offscreen.createDocument()
   SW → Offscreen: START_RECORDING { streamId, apiKey, model }
   SW: setSessionState(RECORDING)
   Offscreen: getUserMedia({ chromeMediaSource: 'tab', ... })
   Offscreen: MediaRecorder.start(5000ms chunks)
   Offscreen → SW: RECORDING_STARTED
        │
        ▼
   State: RECORDING  ←── timer running in popup
        │
        │ User clicks "Stop & Generate Notes"
        ▼
   Popup → SW: STOP_RECORDING
   SW: setSessionState(PROCESSING)
   SW → Offscreen: STOP_RECORDING
   Offscreen: MediaRecorder.stop() → onstop fires
   Offscreen: Blob(audioChunks) [all in memory]
   Offscreen: transcribeAudio(blob, apiKey) → transcript
   Offscreen: summarizeMeeting(transcript, apiKey, model) → notes
   Offscreen → SW: NOTES_READY { notes }
   SW: setNotes(notes), setSessionState(DONE)
        │
        ▼
   State: DONE — notes displayed in popup
        │
        │ User clicks "Clear Notes"
        ▼
   Popup → SW: CLEAR_NOTES
   SW: clearSessionData()
   SW: chrome.offscreen.closeDocument()
        │
        ▼
   State: IDLE (session fully reset)
```

### Error handling

If any step from STOP_RECORDING onwards fails, the offscreen document sends
`PROCESSING_ERROR { error }` and the service worker transitions to `ERROR`
state.  The popup displays the error and a "Try Again" button that calls
`CLEAR_NOTES` to reset.

---

## Audio Processing Flow

1. **Stream ID acquisition**
   `chrome.tabCapture.getMediaStreamId({ targetTabId })` — called in the
   service worker (requires `tabCapture` permission).

2. **Stream opening (offscreen document)**
   ```js
   navigator.mediaDevices.getUserMedia({
     audio: {
       mandatory: {
         chromeMediaSource: 'tab',
         chromeMediaSourceId: streamId,
       }
     },
     video: false
   })
   ```

3. **MediaRecorder configuration**
   Preferred MIME type: `audio/webm;codecs=opus` (highest compression,
   Whisper compatible).  Falls back to `audio/webm` or `audio/ogg;codecs=opus`.

4. **Segment-based recording (live transcript)**
   `MediaRecorder.start(1000)` with a 10-second auto-restart loop.
   Every 10 seconds the active recorder is stopped and a new one immediately
   started on the same `captureStream`.  Each restart produces a **self-contained**
   valid WebM file (its own EBML header), which Whisper can transcribe
   independently.  This avoids the WebM header-sharing problem that would
   occur when slicing a single continuous recording.

5. **Per-segment transcription**
   Each segment's chunks are assembled into a `Blob` and sent to Whisper
   asynchronously.  Results are stored in `transcriptSegments[index]`.
   Multiple Whisper calls can be in-flight simultaneously; final ordering is
   guaranteed by the index.

6. **Track release**
   `captureStream` tracks are stopped in the final `onSegmentStop` call (when
   `isStopRequested` is true).  Per-segment Blobs are GC-eligible after their
   Whisper call completes — no audio accumulates across segments.

---

## AI Processing Flow

### Step 1 — Per-segment Transcription (Whisper, live)

```
POST https://api.openai.com/v1/audio/transcriptions   (once per 10-second segment)
Authorization: Bearer <user-api-key>
Content-Type: multipart/form-data

file:   segment.webm  (self-contained 10-second WebM blob)
model:  whisper-1
response_format: text
```

Returns: plain text for that segment.  Result appended to `transcriptSegments[i]`.
Service worker is notified via `TRANSCRIPT_CHUNK`; side panel appends the text live.

### Step 1b — Transcript Cleanup (GPT, once on stop)

```
POST https://api.openai.com/v1/chat/completions
model: <user-preferred-model>  temperature: 0.1
```

Fixes punctuation, removes filler words, adds paragraph breaks.
Non-fatal: if it fails, the raw transcript is used for summarisation.

### Step 2 — Summarisation (GPT)

```
POST https://api.openai.com/v1/chat/completions
Authorization: Bearer <user-api-key>
Content-Type: application/json

{
  "model": "<user-preferred-model>",
  "temperature": 0.2,
  "messages": [
    { "role": "system", "content": "<structured JSON prompt>" },
    { "role": "user", "content": "Here is the meeting transcript:\n\n<transcript>" }
  ]
}
```

Returns: raw JSON string with keys `summary`, `key_decisions`,
`action_items`, `open_questions`.  Parsed and validated by `validateNotes()`.

### Modularity

Both functions are in `src/lib/openai.js`.  To swap models or add streaming
support, only that file needs to change.  Callers receive a typed `MeetingNotes`
object regardless of the underlying model.

---

## Security Model

### Why no backend?

A backend would require:
- Storing or proxying user API keys (major security surface).
- Handling audio uploads (data retention risk).
- Infrastructure costs and operational complexity.

By running entirely in the user's browser, the extension has no server to
compromise.  The user's API key and audio data stay on their own machine.

### API key storage

- Stored in `chrome.storage.local` — Chrome encrypts this at rest using the
  OS keychain on supported platforms.
- Never logged, never sent to any server other than `api.openai.com`.
- Masked in the settings UI (type="password") by default.

### Audio data

- Never written to `chrome.storage.local` or `chrome.storage.session`.
- Lives only in the offscreen document's JavaScript heap (`audioChunks[]`).
- Cleared immediately after the Whisper API call completes.
- The merged Blob is also released after summarisation.

### Permissions justification

| Permission | Why it is needed |
|-----------|-----------------|
| `tabCapture` | Access the tab's audio stream |
| `offscreen` | Create an offscreen document to run MediaRecorder |
| `storage` | Store API key (local) and session state (session) |
| `activeTab` | Read the URL of the active tab to detect Google Meet |
| `host_permissions: https://meet.google.com/*` | Confirm the active tab is a Meet session |

No `<all_urls>`, no `tabs`, no `webRequest`, no `scripting`.

---

## Contribution Guide

### For human contributors

1. Read `README.md` for the user-facing overview.
2. Read this `CLAUDE.md` for architecture and conventions.
3. Identify which agent role owns the area you are changing (see Agent Definitions).
4. Follow that agent's conventions and review checklist.
5. Run `node scripts/generate-icons.js` if you changed the SVG icon.
6. Test by loading the unpacked extension in Chrome Developer Mode.
7. Ensure `clearSessionData()` is called in any new terminal state.

### For Claude agents

1. Always read this file first, in full.
2. Identify the relevant agent role before writing any code.
3. Check the Security Model section before touching data flow.
4. After making changes, verify the Codebase Map is still accurate.
5. Update this file if you make architectural decisions that change the above.
6. Never add `console.log` statements that could leak API keys or transcripts.

---

## Future Agent Opportunities

The following agents are not yet implemented but are natural extensions of
this architecture.  They are documented here so future contributors can build
them with the existing framework.

### Live Transcript Agent ✅ IMPLEMENTED (v1.1.0)

**Implemented in:** `src/offscreen/offscreen.js`, `src/sidepanel/`, `src/background/service-worker.js`

**Approach used:**
- Segment-based MediaRecorder restart every 10 seconds producing self-contained WebM files.
- Each segment independently transcribed via Whisper; results indexed for ordered joining.
- `TRANSCRIPT_CHUNK` messages relay text to the side panel in near real-time.
- Side panel (`src/sidepanel/`) shows rolling live transcript + 4-tab final notes view.
- `cleanupTranscript()` in `openai.js` runs a GPT light-edit pass before summarisation.

---

### Speaker Detection Agent

**Goal:** Identify speakers in the transcript (e.g., "Speaker A", "Speaker B")
using diarisation.

**Approach:**
- Use the OpenAI Whisper `timestamp_granularities` parameter for word-level
  timestamps, then heuristically separate speakers by pause patterns.
- Or integrate a third-party diarisation API (user provides that key too).
- Annotate `action_items` and `key_decisions` with speaker attribution.

**Complexity:** High — requires audio analysis beyond what Whisper natively provides.

---

### Local AI Integration Agent

**Goal:** Support running transcription and summarisation entirely offline
using locally-hosted models (e.g., via Ollama or a WASM runtime).

**Approach:**
- Add a settings option: "Use local AI" with a configurable endpoint.
- Abstract the API call layer in `openai.js` behind a provider interface.
- Implement a `LocalProvider` that calls `http://localhost:11434` (Ollama)
  instead of `api.openai.com`.
- No API key required in this mode.

**Complexity:** Medium — requires provider abstraction and UX for local
model selection.

---

### Meeting History Agent

**Goal:** Optionally persist summaries (not audio) across sessions with
user consent.

**Approach:**
- Add an opt-in setting: "Save meeting summaries".
- Store structured notes in `chrome.storage.local` under a dated key.
- Add a "History" view to the popup or options page.
- Provide a one-click "Delete all history" button.

**Privacy note:** Audio and transcripts must never be persisted even with
this agent active.  Only the final structured `MeetingNotes` object may be saved.

**Complexity:** Low — mostly UI and storage work, no new APIs required.
