# Cadence

> **Working brand name — see [docs/phase-4-branding.md](docs/phase-4-branding.md) for the full shortlist.**
> *Note: "TypingDNA" (the folder name) is already a registered company in the keystroke-biometrics space, so the product should ship under a distinct name.*

Cadence is a typing-personalization suite. It profiles **your own** physical typing behavior — speed, rhythm, error and correction habits, and the way you pace yourself when a sentence is easy versus hard — and produces a small, portable behavior profile. Cadence then ships as **its own standalone Chrome (MV3) extension** that inserts AI-drafted or clipboard text into web inputs using *your* cadence, instead of an instantaneous, robotic paste.

## How it fits together

Cadence is **not** a plugin for, and does not integrate into, the first-party "Claude for Chrome" extension — that extension is closed and can't be extended by third parties. Instead, Cadence separates the two concerns the product needs:

- **Generate the text** — any LLM. Best path is the Claude API (e.g. `claude-opus-4-8` for quality, `claude-haiku-4-5` for speed/cost); you can also paste text in from the claude.ai web app.
- **Type it with your cadence** — Cadence's own extension, which owns the command parsing, profile storage, and keystroke injection.

These layers are deliberately decoupled (see [docs/phase-3-architecture.md](docs/phase-3-architecture.md)), so the text source is swappable and the extension stands on its own. Being a standalone extension is also what unlocks the `chrome.debugger`/CDP injection path needed for hardened editors like Google Docs.

## Why this exists (intended uses)

- **Accessibility / RSI:** people who fatigue easily or can't sustain typing, but who want the *output* to read and feel like their own keyboarding on their own accounts.
- **Personal automation:** you draft with an assistant, then have it entered into your own documents/messages at a natural, non-jarring pace.
- **Behavioral-biometrics research & QA:** generating realistic keystroke streams to test, harden, or evaluate input pipelines and behavioral models *that you own or are authorized to test*.

Please read **[ACCEPTABLE_USE.md](ACCEPTABLE_USE.md)** before building on this. The realism features here are powerful; the project is explicitly scoped to *your own* identity, *your own* accounts, and *authorized* testing — not to impersonating other people, defeating exam proctoring or academic-integrity checks, or evading anti-fraud/bot controls on services whose terms prohibit automation.

## The four design phases

| Phase | Doc | What it covers |
|-------|-----|----------------|
| 1 | [Calibration GUI & Profiling Suite](docs/phase-1-calibration-gui.md) | The capture UX and the exact exercises that produce a profile. |
| 2 | [Simulation Engine & Context-Aware Variables](docs/phase-2-simulation-engine.md) | The math/model that turns a profile + target text into a realistic keystroke plan. |
| 3 | [Architecture & Implementation](docs/phase-3-architecture.md) | Command parsing, profile serialization, and DOM/event injection in modern web apps. |
| 4 | [Branding](docs/phase-4-branding.md) | Name shortlist with pitches. |

## Repo layout

```
.
├── docs/                       # The four-phase design
├── schema/                     # Portable profile format (JSON Schema + example)
├── packages/
│   ├── engine/                 # Core simulation engine (TypeScript, framework-agnostic)
│   ├── extension/              # Standalone Chrome (MV3) extension skeleton + injection notes
│   └── calibration-app/        # The capture GUI (notes / scaffold)
├── ACCEPTABLE_USE.md
└── LICENSE
```

## Status

Design + reference scaffold. The `engine` package contains a working, dependency-free reference implementation of the keystroke-planning model described in Phase 2. The extension and calibration app are scaffolds with implementation notes.
