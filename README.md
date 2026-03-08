# Open Meeting Scribe

> A Chrome extension for Google Meet that records your meeting audio and
> generates structured notes using OpenAI — no backend required.

![Chrome Extension](https://img.shields.io/badge/Chrome%20Extension-MV3-4285F4?logo=googlechrome&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Privacy: No backend](https://img.shields.io/badge/Privacy-No%20backend-green)

---

## Features

- **Live transcript side panel** — rolling transcript appears as you speak, every ~10 seconds.
- **One-click recording** — click Start, have your meeting, click Stop.
- **Automatic transcription** — powered by OpenAI Whisper (per-segment, near real-time).
- **Transcript cleanup** — GPT light-edit pass removes filler words and fixes punctuation.
- **Structured meeting notes** — Summary, Key Decisions, Action Items, Open Questions.
- **4-tab final view** — Live Transcript, Final Transcript, Summary, Actions.
- **Privacy-first** — audio never leaves your browser until it reaches OpenAI directly.
- **No backend** — your API key, your data.
- **Copy to clipboard** — paste notes anywhere in seconds.

---

## Privacy

| What happens | Details |
|-------------|---------|
| Audio recording | Buffered **in memory only** during the meeting |
| Transcription | Sent directly from your browser to OpenAI Whisper |
| Meeting notes | Displayed and then cleared from memory |
| API key | Stored locally in Chrome (encrypted at rest) |
| Backend servers | **None** |
| Telemetry | **None** |

Meeting audio is **never written to disk**.  Session data is cleared as soon
as you dismiss the notes.

---

## Requirements

- **Chrome 116+** (required for Offscreen Document and Side Panel APIs)
- An **OpenAI API key** — get one at [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- A **Google Meet** session

---

## Installation

### From the Chrome Web Store *(coming soon)*

Search for "Open Meeting Scribe" or use the direct link once published.

### Manual installation (development)

```bash
# 1. Clone the repository
git clone https://github.com/your-username/open-meeting-scribe.git
cd open-meeting-scribe

# 2. Install optional dev dependencies (for high-quality icons)
npm install

# 3. Generate PNG icons
npm run generate-icons

# 4. Load in Chrome
#    Open chrome://extensions
#    Enable "Developer mode" (top-right toggle)
#    Click "Load unpacked" → select the project root directory
```

---

## Setup

1. After installing, the settings page opens automatically.
2. Paste your OpenAI API key — it is saved locally and never leaves your device
   except in requests to `api.openai.com`.
3. Optionally choose a GPT model for note generation.

To access settings later: click the extension icon → gear icon.

---

## Usage

1. Join a Google Meet.
2. Click the **Open Meeting Scribe** extension icon.
3. Click **Start Meeting Notes**.
4. Click **View Live Transcript** to open the side panel — the rolling transcript appears there as you speak.
5. Conduct your meeting normally.
6. When finished, click **Stop & Generate Notes** (popup or side panel).
7. Wait a moment while the final transcript is cleaned up and notes are generated.
8. Browse the 4 tabs in the side panel: Transcript, Final, Summary, Actions.
9. **Copy** or **Clear** when done.

---

## Meeting Notes Structure

```
Summary
  2–4 sentence overview of the meeting.

Key Decisions
  • Decision 1
  • Decision 2

Action Items
  • [Owner] Task by [date if mentioned]

Open Questions
  • Question that needs follow-up
```

---

## Development

### Project structure

```
open-meeting-scribe/
├── manifest.json
├── src/
│   ├── background/service-worker.js   # State machine + message routing
│   ├── offscreen/offscreen.{html,js}  # MediaRecorder + OpenAI calls
│   ├── popup/popup.{html,js,css}      # Extension popup UI
│   ├── sidepanel/sidepanel.{html,js,css} # Live transcript + 4-tab notes view
│   ├── options/options.{html,js,css}  # Settings page
│   └── lib/
│       ├── openai.js                  # Whisper + cleanupTranscript + GPT
│       └── storage.js                 # chrome.storage wrappers
├── public/icons/                      # Extension icons
├── scripts/
│   ├── generate-icons.js              # Generates PNG icons from SVG
│   └── package.js                     # Creates Web Store ZIP
└── CLAUDE.md                          # Architecture doc for Claude agents
```

See [CLAUDE.md](CLAUDE.md) for the full architecture documentation.

### Available scripts

```bash
npm run generate-icons   # Generate PNG icons from public/icons/icon.svg
npm run package          # Create dist/open-meeting-scribe-<version>.zip
```

### Reloading after changes

1. Edit source files.
2. Go to `chrome://extensions`.
3. Click the reload icon next to Open Meeting Scribe.
4. Re-open the popup or settings page.

---

## Packaging for Chrome Web Store

```bash
# 1. Bump version in manifest.json and package.json
# 2. Generate fresh icons
npm run generate-icons

# 3. Create the ZIP
npm run package

# 4. Upload dist/open-meeting-scribe-<version>.zip at:
#    https://chrome.google.com/webstore/devconsole
```

---

## Limitations

- **Tab audio only** — participant microphones on the remote side are captured
  via their encoded audio stream; the local microphone is not included unless
  Meet mixes it into the tab output.
- **No speaker diarisation** — the transcript does not identify who said what.
- **Long meetings** — very long recordings (> 60 min) may hit OpenAI file
  size limits.  The Whisper API currently accepts files up to 25 MB.
- **Requires tab focus** — Chrome's tab capture API requires the target tab
  to be the active tab when recording starts.
- **Chrome only** — Manifest V3 offscreen documents and tab capture are
  Chrome-specific.

---

## Contributing

Contributions are welcome.  Please read [CLAUDE.md](CLAUDE.md) for the
architecture overview and agent conventions before opening a PR.

1. Fork the repository.
2. Create a feature branch: `git checkout -b feat/my-feature`.
3. Make your changes, following the relevant agent conventions in CLAUDE.md.
4. Test by loading the unpacked extension.
5. Open a pull request.

---

## Security

Please report security vulnerabilities via the process described in
[SECURITY.md](SECURITY.md).  Do not file public issues for security matters.

---

## License

[MIT](LICENSE) © Open Meeting Scribe Contributors
# open-meeting-scribe
