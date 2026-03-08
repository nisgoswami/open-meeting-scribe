# Open Meeting Scribe

> A Chrome extension for Google Meet that records your meeting audio and
> generates structured notes — works with OpenAI, DeepSeek, LM Studio, Ollama,
> or any OpenAI-compatible endpoint. No backend required.

![Chrome Extension](https://img.shields.io/badge/Chrome%20Extension-MV3-4285F4?logo=googlechrome&logoColor=white)
![License: GPL-3.0](https://img.shields.io/badge/License-GPL%203.0-blue.svg)
![Privacy: No backend](https://img.shields.io/badge/Privacy-No%20backend-green)

---

## Features

- **Live transcript side panel** — rolling transcript appears as you speak via the browser's Web Speech API.
- **One-click recording** — click Start, have your meeting, click Stop.
- **Transcript cleanup** — removes filler words and fixes punctuation (or skip it entirely).
- **Structured meeting notes** — Summary, Key Decisions, Action Items, Open Questions.
- **Multi-provider** — use OpenAI, DeepSeek, LM Studio, Ollama, or a custom endpoint.
- **Run fully local** — pair LM Studio or Ollama with Meet captions for zero cloud dependency.
- **4-tab final view** — Live Transcript, Final Transcript, Summary, Actions.
- **Privacy-first** — audio never leaves your browser until it reaches your chosen provider.
- **No backend** — your keys, your data.

---

## Providers

| Provider | Cleanup | Summary | Requires key | Notes |
|----------|:-------:|:-------:|:------------:|-------|
| OpenAI | ✓ | ✓ | Yes | Cloud |
| DeepSeek | — | ✓ | Yes | Cloud, very cost-efficient |
| LM Studio | ✓ | ✓ | No | Local, runs on your machine |
| Ollama | ✓ | ✓ | No | Local, runs on your machine |
| Custom endpoint | ✓ | ✓ | Optional | Any OpenAI-compatible API |
| Skip (cleanup only) | ✓ | — | No | Uses raw transcript as-is |

---

## Privacy

| What happens | Details |
|-------------|---------|
| Audio recording | Buffered **in memory only** during the meeting |
| Transcription | Browser-native Web Speech API — no audio sent anywhere |
| Transcript cleanup / notes | Sent directly from your browser to your chosen provider |
| API keys | Stored locally in Chrome (encrypted at rest) |
| Backend servers | **None** |
| Telemetry | **None** |

Meeting audio is **never written to disk**. Session data is cleared as soon as you dismiss the notes.

---

## Requirements

- **Chrome 116+**
- A **Google Meet** session
- An API key for your chosen cloud provider (not needed for LM Studio / Ollama)

---

## Installation

### From the Chrome Web Store *(coming soon)*

Search for "Open Meeting Scribe" or use the direct link once published.

### Manual installation (development)

```bash
# 1. Clone the repository
git clone https://github.com/your-username/open-meeting-scribe.git
cd open-meeting-scribe

# 2. Install optional dev dependencies (for icon generation)
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
2. Choose your **Provider Settings** — cleanup provider and summary provider independently.
3. If using OpenAI, the API key section appears automatically after you select it.
4. Save and you're ready.

To access settings later: click the extension icon → gear icon.

---

## LM Studio Setup

[LM Studio](https://lmstudio.ai) lets you run large language models locally on your machine — no API key, no cloud, completely private.

### 1. Install LM Studio

Download from [lmstudio.ai](https://lmstudio.ai) and install it (macOS, Windows, Linux supported).

### 2. Download a model

Open LM Studio and go to the **Discover** tab. Recommended models for meeting notes:

| Model | Size | Good for |
|-------|------|----------|
| `mistral-7b-instruct` | ~4 GB | Both cleanup and summary |
| `llama-3.1-8b-instruct` | ~5 GB | Both cleanup and summary |
| `phi-3-mini-4k-instruct` | ~2 GB | Low-RAM machines |
| `qwen2.5-7b-instruct` | ~5 GB | Strong structured output |

Search for the model name, click Download, and wait for it to finish.

### 3. Start the local server

1. Go to the **Local Server** tab (the `<->` icon in the left sidebar).
2. Select your downloaded model from the dropdown at the top.
3. Click **Start Server**.
4. The server starts on `http://localhost:1234` by default.

You should see:
```
Server running at http://localhost:1234
```

### 4. Configure Open Meeting Scribe

1. Open the extension settings (gear icon).
2. Under **Provider Settings → Transcript Cleanup**, select **LM Studio (local)**.
3. Under **Provider Settings → Meeting Summary**, select **LM Studio (local)**.
4. Set **Base URL** to `http://localhost:1234/v1` (this is the default).
5. Set **Model** to the exact model name shown in LM Studio, e.g. `mistral-7b-instruct`.
6. Click **Save Provider Settings**.

> **Tip:** The model name must match exactly what LM Studio shows. You can find it in the Local Server tab under the model selector.

### 5. Test it

Start a recording, say a few sentences, stop, and wait for notes. If the model is loaded and the server is running, notes will generate entirely on-device.

### Troubleshooting LM Studio

| Problem | Fix |
|---------|-----|
| Notes never appear / error shown | Make sure the server is running and the model is loaded |
| Wrong model name | Copy the model identifier exactly from LM Studio's server tab |
| Very slow generation | Use a smaller model or enable GPU acceleration in LM Studio settings |
| CORS error in console | LM Studio server allows all origins by default — check it hasn't been restricted |
| Port already in use | Change the port in LM Studio and update the Base URL in extension settings accordingly |

---

## Ollama Setup

[Ollama](https://ollama.com) is another local runner with a large model library.

### 1. Install Ollama

```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows: download installer from https://ollama.com
```

### 2. Pull a model

```bash
ollama pull llama3.1
# or
ollama pull mistral
# or
ollama pull qwen2.5
```

### 3. Configure Open Meeting Scribe

1. Select **Ollama (local)** for cleanup and/or summary providers.
2. Set **Base URL** to `http://localhost:11434/v1`.
3. Set **Model** to the model name you pulled, e.g. `llama3.1`.
4. Save.

> Ollama's OpenAI-compatible endpoint requires **Ollama 0.1.24 or later**.

---

## Usage

1. Join a Google Meet.
2. Click the **Open Meeting Scribe** extension icon.
3. Click **Start Meeting Notes**.
4. Click **View Live Transcript** to open the side panel.
5. Conduct your meeting.
6. Click **Stop & Generate Notes** when finished.
7. Browse the 4 tabs: Transcript, Final, Summary, Actions.
8. **Copy** or **Clear** when done.

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
│   ├── background/service-worker.js        # State machine + message routing
│   ├── content/MeetCaptionObserver.js       # Experimental: Meet caption scraping
│   ├── popup/popup.{html,js,css}           # Extension popup UI
│   ├── sidepanel/sidepanel.{html,js,css}   # Live transcript + 4-tab notes view
│   ├── options/options.{html,js,css}       # Settings page
│   └── lib/
│       ├── openai.js                       # Legacy transcription helpers
│       ├── storage.js                      # chrome.storage wrappers
│       ├── MeetingSessionController.js     # SpeechRecognition orchestrator
│       ├── SpeechRecognitionManager.js     # Web Speech API wrapper
│       ├── TranscriptBuffer.js             # Final/interim text accumulator
│       ├── TranscriptSourceManager.js      # Captions ↔ speech fallback state machine
│       └── providers/
│           ├── prompts.js                  # Shared system prompts
│           ├── OpenAICompatibleProvider.js # Base provider (cleanup + summarize)
│           ├── SkipCleanupProvider.js      # No-op cleanup
│           └── ProviderRegistry.js         # Factory: reads settings, returns providers
├── public/icons/
├── scripts/
│   ├── generate-icons.js
│   └── package.js
└── CLAUDE.md
```

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

- **No speaker diarisation** — the transcript does not identify who said what (unless Google Meet captions are enabled via the experimental setting).
- **Web Speech API** — accuracy varies by browser and microphone quality. Background noise or heavy accents may reduce quality.
- **Chrome only** — Manifest V3 side panel and Web Speech API behaviour is Chrome-specific.
- **Local models** — smaller models may produce lower-quality structured output. Use at least a 7B instruction-tuned model for best results.

---

## Contributing

Contributions are welcome. Please read [CLAUDE.md](CLAUDE.md) for the architecture overview before opening a PR.

1. Fork the repository.
2. Create a feature branch: `git checkout -b feat/my-feature`.
3. Test by loading the unpacked extension in Chrome.
4. Open a pull request.

---

## Security

Please report security vulnerabilities via the process described in [SECURITY.md](SECURITY.md). Do not file public issues for security matters.

---

## License

[GPL-3.0](LICENSE) © Open Meeting Scribe Contributors
