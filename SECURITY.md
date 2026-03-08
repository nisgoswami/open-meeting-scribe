# Security Policy — Open Meeting Scribe

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |

We support only the latest published release.  Please update before reporting
a vulnerability.

---

## Reporting a Vulnerability

**Do not file a public GitHub issue for security vulnerabilities.**

Please report vulnerabilities by opening a
[GitHub Security Advisory](https://github.com/your-username/open-meeting-scribe/security/advisories/new)
in this repository (requires a GitHub account).  This keeps the disclosure
private until a fix is released.

Alternatively, email the maintainers at a contact address listed in the
repository's GitHub profile.

### What to include

- A clear description of the vulnerability.
- Steps to reproduce, including the Chrome version and extension version.
- The potential impact (data exposure, privilege escalation, etc.).
- Any proof-of-concept code or screenshots (mark as sensitive).

### Response timeline

- **Acknowledgement** — within 3 business days.
- **Initial assessment** — within 7 business days.
- **Fix and disclosure** — we aim to release a patch within 30 days for
  critical issues.

---

## Security Architecture

### What this extension does with sensitive data

| Data | Storage | Cleared |
|------|---------|---------|
| OpenAI API key | `chrome.storage.local` (Chrome-encrypted) | On user request via Settings |
| Meeting audio | In-memory only (JS heap) | After OpenAI API call returns |
| Transcript text | Sent to OpenAI, never stored | Immediately after summary is generated |
| Meeting notes | `chrome.storage.session` (in-memory) | When user clicks "Clear Notes" |

### What this extension does NOT do

- Does not proxy requests through any backend server.
- Does not store audio, transcripts, or notes to disk.
- Does not send data to any service other than `api.openai.com`.
- Does not use analytics, crash reporting, or telemetry.
- Does not inject content scripts into pages.
- Does not request broad host permissions (`<all_urls>`).

### Permissions

The extension uses the minimum permissions required:

- `tabCapture` — capture tab audio stream.
- `offscreen` — run MediaRecorder in a headless document.
- `storage` — store API key and ephemeral session state.
- `activeTab` — check if the current tab is a Google Meet URL.
- `host_permissions: https://meet.google.com/*` — detect Meet sessions.

### Known limitations

- The OpenAI API key is as sensitive as a password.  Users should use an
  API key scoped to the minimum required permissions on their OpenAI account
  (e.g., create a dedicated key for this extension).
- If a user's Chrome profile is compromised, the stored API key may be
  accessible.  This is a Chrome / OS-level concern, not specific to this
  extension.
- Meeting audio is transmitted to OpenAI for transcription.  Users should
  review OpenAI's data usage policies and ensure they have appropriate
  consent from meeting participants.

---

## Responsible Disclosure

We follow the principle of coordinated vulnerability disclosure.  We ask
researchers to:

1. Report vulnerabilities privately using the channels above.
2. Allow reasonable time for a fix to be developed and deployed.
3. Not exploit vulnerabilities beyond what is necessary to demonstrate the issue.
4. Not access, modify, or delete user data during testing.

In return, we commit to:

1. Acknowledge reports promptly.
2. Keep reporters informed of progress.
3. Credit researchers in the release notes (unless they prefer anonymity).
4. Not pursue legal action against good-faith security researchers.
