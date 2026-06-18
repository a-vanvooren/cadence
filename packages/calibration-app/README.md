# Cadence — Calibration App ("The Tuning Room")

> ℹ️ **A working version of this now ships inside the extension** as its options
> page — see [`packages/extension`](../extension) (`calibrate.html` +
> `profile-derive.js`), which captures keystrokes and saves a profile to
> `chrome.storage.local` with no build step. This package remains the place for a
> standalone, richer web build (WebGL waveform, generative audio, archetype card).

The capture GUI from [Phase 1](../../docs/phase-1-calibration-gui.md). A static web
app (no server in the capture path) that records a raw keystroke stream, derives a
`TypingProfile`, and exports it for the extension.

## Stack (intended)

- **Svelte or React + Vite** for the app shell.
- **Canvas / WebGL** for the live keystroke waveform and the DNA-helix progress.
- **Web Audio API** for the optional generative keystroke audio (off by default).
- **Zod** to validate the emitted profile against `../../schema/typing-profile.schema.json`.

## Capture contract

Record, per keystroke, the raw event only:

```ts
interface RawKey { key: string; code: string; type: 'down' | 'up'; t: number /* ms, performance.now() */ }
```

Everything in the profile (bigram latencies, dwell, error/correction model,
burst structure, fatigue estimate) is **derived offline** from `RawKey[]`, so the
same capture can train better models later. Raw logs stay on-device unless the
user explicitly opts into uploading them.

## Exercise sequence

| # | Name | ~Time | Primary signal |
|---|------|-------|----------------|
| 0 | Warm-up (discarded) | 15s | settle / calibrate |
| 1 | Baseline speed & flow | 45s | WPM, inter-key mean/variance, dwell |
| 2 | Bigram/trigram travel | 45s | per-pair latency table |
| 3 | Errors & corrections | 45s | error rate, correction fingerprint, typo mix |
| 4 | Layout anchors & reach | 30s | per-key reach cost, modifier behavior |
| 5 | Burstiness & pacing | 45s | burst length, inter-burst pause, lexical hesitation |

See Phase 1 for the exact prompt text and the data-quality rules (no live WPM, no
red error flashes, discard the warm-up).

## Output

A single profile JSON conforming to the schema, plus a shareable "Your Signature"
results card (waveform-as-art + archetype). The profile is the only artifact the
extension consumes.
