# Cadence

> **Working brand name — see [docs/phase-4-branding.md](docs/phase-4-branding.md) for the full shortlist.**
> *Note: "TypingDNA" (the original folder name) is already a registered company in the keystroke-biometrics space, so the product ships under a distinct name.*

Cadence profiles **your own** physical typing behavior — speed, rhythm, error and correction habits, and how you pace yourself when a sentence is easy versus hard — and reproduces that cadence when entering AI-drafted or clipboard text into web fields. Instead of an instant, robotic paste, the text appears the way *you* would have typed it.

It ships as a **standalone Chrome (MV3) extension** with **no build step** — load the folder unpacked and it runs.

---

## Quick start — install the extension

> Requires Google Chrome (or any Chromium browser: Edge, Brave, Arc). No Node, npm, or build tools needed.

1. **Get the code.**
   ```bash
   git clone https://github.com/a-vanvooren/cadence.git
   ```
   (or download the ZIP from GitHub and unzip it).
2. Open Chrome → go to **`chrome://extensions`**.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the **`packages/extension`** folder inside the repo.
5. The Cadence icon (the waveform mark) appears in your toolbar. Pin it for easy access.

To update later: `git pull`, then hit the **⟳ refresh** icon on the Cadence card in `chrome://extensions`.

---

## Using it

### 1. Calibrate (make it type like *you*)
Click the Cadence icon → **Calibrate your typing →** (opens the full-page "Tuning Room"). Do the ~3-minute prompts — type naturally, mistakes and all — then **Save & use this profile**. Your profile is derived on-device and stored locally; the popup footer switches to **"Profile: yours (NN WPM)."** Until you calibrate, a bundled example profile is used.

### 2. Type something
1. Click into any text box on a page (search box, email body, comment field…).
2. Open the Cadence popup, paste/than type your text, pick a **Load** (Light/Medium/Heavy) and **Speed**, and press **Type it**.
3. Watch it type with human timing — typos that get corrected, burst pauses, lexical hesitations. A floating **Stop** panel appears on the page; the target field is highlighted with a colored caret. It keeps typing into that field even if you click elsewhere.

### 3. Whisper Mode (discreet, hands-free)
Flip the **Whisper Mode** toggle in the popup. The interface shifts to a quieter, darker skin, and:
- **No on-screen markers** — no field highlight, no caret tint, no Stop HUD.
- **Hotkey from clipboard** — focus a field and press **Ctrl+Shift+Y** (Mac: ⌘+Shift+Y) to type your latest clipboard contents at the cursor, without opening the popup.
- **Stop from the extension** — since there's no on-page Stop button, open the popup and press **Stop**.

Rebind the shortcut at `chrome://extensions/shortcuts`. The popup shows your current binding.

---

## Features

- **On-device calibration** ("Tuning Room") with a live keystroke waveform and a "Your Signature" archetype.
- **Context-aware pacing** — Light/Medium/Heavy cognitive load changes thinking pauses; long hesitation before quoted/cited material.
- **Realistic humanization** — spatial-adjacency typos, transpositions, your correction style (single backspace / bursts / whole-word delete), burst micro-chunking, lexical hesitation, punctuation/shift delays, and gentle fatigue decay.
- **Target locking** — types into the field you chose even if you click away.
- **Stop control** — in-page HUD (normal) or popup Stop (always).
- **Colored caret + field highlight** showing where and when it types.
- **Whisper Mode** — discreet, marker-free, clipboard-hotkey typing.
- **Profile management** — delete (revert to example) or recalibrate (overwrite).
- **Privacy** — raw keystrokes never leave your machine; the profile lives in `chrome.storage.local`.

---

## How it fits together

Cadence is **not** a plugin for the first-party "Claude for Chrome" extension — that one is closed and can't be extended. Cadence is its own extension and separates two concerns:

- **Generate the text** — any LLM (best path: the Claude API, e.g. `claude-opus-4-8` for quality or `claude-haiku-4-5` for speed/cost), or just paste it in.
- **Type it in your cadence** — Cadence owns the command parsing, profile storage, and keystroke injection.

These layers are deliberately decoupled (see [docs/phase-3-architecture.md](docs/phase-3-architecture.md)).

## Why this exists (intended uses)

- **Accessibility / RSI** — reduce the physical load of typing while keeping output that reads like your own keyboarding on your own accounts.
- **Personal automation** — draft with an assistant, enter it into your own docs/messages at a natural pace.
- **Behavioral-biometrics research & QA** — realistic keystroke streams to test systems *you own or are authorized to test*.

Please read **[ACCEPTABLE_USE.md](ACCEPTABLE_USE.md)**. The realism here is scoped to *your own* identity, *your own* accounts, and *authorized* testing — not impersonating others, defeating proctoring/academic-integrity or biometric auth, or evading platform anti-fraud controls. Note also: injected events are `isTrusted:false` and are **not** marketed as undetectable.

---

## The design (four phases)

| Phase | Doc | What it covers |
|-------|-----|----------------|
| 1 | [Calibration GUI & Profiling Suite](docs/phase-1-calibration-gui.md) | The capture UX and the exact exercises that produce a profile. |
| 2 | [Simulation Engine & Context-Aware Variables](docs/phase-2-simulation-engine.md) | The model that turns a profile + text into a realistic keystroke plan. |
| 3 | [Architecture & Implementation](docs/phase-3-architecture.md) | Command parsing, profile serialization, DOM/event injection. |
| 4 | [Branding](docs/phase-4-branding.md) | Name shortlist with pitches. |

## Repo layout

```
.
├── docs/                       # The four-phase design
├── schema/                     # Portable profile format (JSON Schema + example)
├── packages/
│   ├── engine/                 # Core simulation engine (TypeScript, framework-agnostic)
│   ├── extension/              # The runnable Chrome (MV3) extension — load this unpacked
│   └── calibration-app/        # Notes for a future standalone calibration web build
├── ACCEPTABLE_USE.md
└── LICENSE
```

The `packages/engine` package is a TypeScript reference of the model; the extension ships a dependency-free plain-JS port (`packages/extension/engine.js`) so it runs with no build step.

## Status

Working MVP. Standard inputs, textareas, and most rich editors are supported. Canvas/hardened editors (e.g. Google Docs) need the **Tier B** `chrome.debugger`/CDP injection path described in Phase 3, which is not yet built.
