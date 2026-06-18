# Phase 1 — The Calibration GUI & Profiling Suite

The goal of calibration is to capture enough signal to reconstruct *how* you type in about **3–4 minutes**, without it feeling like a typing test. Three to four minutes is the sweet spot: long enough for stable bigram statistics and a fatigue read, short enough that people finish.

## 1.1 The GUI concept: "The Tuning Room"

Frame calibration not as a *test* (which implies pass/fail and makes people self-conscious, which corrupts the data) but as **tuning an instrument that is you**. The metaphor running through the UI is an audio/synth studio: your keystrokes are a waveform, and we're sampling your "signature sound."

**Visual language**

- **Dark, focused canvas.** Near-black background, one calibration card centered, everything else dimmed. No nav, no chrome — a "cockpit" feel.
- **Live keystroke waveform.** As you type, render an oscilloscope-style line where each keypress is a spike whose height = dwell time and spacing = inter-key latency. People *see their own rhythm* forming. This is the hook — it's mesmerizing and it quietly teaches the user what we're measuring.
- **The "DNA helix" fill.** A progress element shaped like a double helix that fills/braids as each metric locks in (speed strand, rhythm strand, error strand, anchor strand). Ties to the biometric concept without the clinical vibe.
- **Heatmap keyboard.** A faint on-screen keyboard that warms (blue→amber) on the keys you've struck, so coverage is visible and the late exercises can nudge you toward unsampled keys.
- **Ambient generative audio (optional, off by default).** Each keypress triggers a soft synth note quantized to a scale; faster typing = denser arpeggio. Turns the act of typing into music. Mute toggle front and center because some users will hate it.

**Interaction principles that protect data quality**

- **No visible WPM counter during capture.** A live score makes people perform rather than type naturally. Reveal stats only on the results screen.
- **No red error flashes mid-exercise.** Highlighting mistakes changes correction behavior. We *want* to observe natural corrections, so we stay silent and just record.
- **"Warm-up" round that is discarded.** The first ~15 seconds are explicitly labeled a warm-up and excluded from the profile, so first-prompt jitters don't skew the baseline.
- **Calm pacing.** Between exercises, a one-line "what we just learned about you" reveal (e.g., *"You favor Ctrl+Backspace — efficient."*). This gamifies via *insight*, not via score-chasing.

**Results screen — "Your Signature"**

A shareable card: your waveform rendered as art, your headline numbers (baseline WPM, rhythm "groove" descriptor, correction style archetype), and an archetype name (e.g., *"The Burst Sprinter,"* *"The Steady Metronome,"* *"The Backspace Surgeon"*). Archetypes make the abstract profile feel like a personality result, which drives sharing and re-engagement — and gives the user a sanity check ("yeah, that's me").

## 1.2 The profiling metrics & the exact exercise sequence

Each exercise targets specific signal. We capture, for **every** keystroke, the raw event stream: `{key, code, type: down|up, timestamp}`. Everything else is derived from that stream offline, so the same capture can feed better models later.

### Exercise 0 — Warm-up (discarded) · ~15s
Prompt: a friendly pangram-ish sentence.
> *"The quiet fox waits by the river as the morning light spills over the hills."*
Purpose: settle the user; calibrate the audio/visual; thrown away.

### Exercise 1 — Baseline speed & flow · ~45s
A short passage of **common, high-frequency English** with natural punctuation, no rare words, no numbers.
> *"It was clear by the time we got there that the others had already left. She told me not to worry about it, so I tried my best to relax and enjoy the rest of the afternoon with everyone."*

**Captures:**
- **Baseline WPM** = (chars/5) / minutes, over the steady-state middle of the passage.
- **Mean & variance of inter-key latency** — the core of your rhythm.
- **Dwell time** (key-down → key-up) distribution.

### Exercise 2 — Bigram / trigram travel latencies · ~45s
A passage **engineered to oversample common English bigrams/trigrams** (`th`, `he`, `in`, `er`, `an`, `the`, `ing`, `ion`) and same-finger vs. alternating-hand transitions.
> *"The thing in the other room is that the singer is bringing in another string of songs, and then there is nothing in the thinking that things are interesting."*
(Deliberately heavy on `th/the/thing/ing/in/er` — clumsy to read, perfect for sampling.)

**Captures:**
- A **per-bigram latency table** (median ms for each frequent pair). This is what makes the playback sound like *you*: alternating-hand bigrams are fast, same-finger bigrams (`ed`, `un`, hurdles like `my`) are slow, and the ratios are personal.
- **Trigram latency** for the top sequences, capturing roll/chord effects a bigram table misses.

### Exercise 3 — Errors & correction fingerprint · ~45s
Two sub-tasks designed to *provoke* natural error-and-correct behavior:
1. A sentence with **tricky/unfamiliar proper nouns and clusters** that induce real typos (e.g., *"Przybylski," "rhythm," "unwieldy," "mischievous," "Worcestershire"*).
2. A "type-from-memory" micro-task: read a short phrase, it disappears, you reproduce it — recall pressure produces authentic mistakes.

**Captures (the correction fingerprint):**
- **Error rate** (uncorrected + corrected) per 100 chars.
- **Correction style:** do you fire single backspaces, *spam* backspace, use **Ctrl/Option+Backspace** to nuke a whole word, or select-and-retype? We classify into archetypes and store weights.
- **Correction latency:** how long *after* the wrong key do you notice and start fixing? (Some catch it in 1 key, some at end of word, some at end of sentence.)
- **Typo taxonomy:** spatial-adjacency substitutions (`s`→`a`), transpositions (`teh`), doubled letters, dropped letters. Stored as weights so playback reproduces *your* mistake mix.

### Exercise 4 — Layout anchors & finger reach · ~30s
A short, *guided* drill (the only "drill"-feeling part, kept brief) that walks the hands across the board: home row, top-row numbers, symbol reaches (`@ # ! ? ( ) - / "`), and a couple of awkward stretches (`p`, `q`, `z`, `-`, `=`).
> *"Email me at sam_07@work-mail.com — re: Q4 (yes!), budget #3 is ~ $1,250.50; that's a lot, right?"*

**Captures:**
- **Per-key dwell and reach cost** relative to home row — i.e., the extra latency to reach distant keys and to engage modifiers. This is the "physical finger reaching distance" signal.
- **Modifier behavior:** Shift dwell for capitals, whether you hold-and-roll for symbols, left vs. right Shift bias (inferable from which Shift `code` precedes which letters).
- **Number-row vs. number-pad** tendency.

### Exercise 5 — Burstiness & cognitive pacing · ~45s
A *compose-your-own* micro-prompt rather than copy-typing, because copying suppresses the natural think-type-think rhythm.
> *"In two or three sentences, describe what you did last weekend."*

**Captures:**
- **Burst structure:** the natural length (in words/chars) of your uninterrupted typing runs and the **inter-burst pause** distribution — humans type in rhythmic chunks of ~3–5 words, then pause to phrase the next chunk.
- **Lexical hesitation:** pauses preceding longer/rarer words you chose yourself.
- **Fatigue baseline:** combined with the other timed exercises, gives a first read on how your latency drifts as total characters accumulate.

> **Note on fatigue:** a 3–4 minute calibration only lightly samples fatigue. The profile stores a *conservative* decay estimate; the simulation engine treats fatigue as a tunable model (see Phase 2) that can also be refined passively over time if the user opts into on-device learning.

## 1.3 What comes out

Calibration emits a single **typing profile** (Phase 3 / `schema/typing-profile.schema.json`) containing: baseline speed & variance, the bigram/trigram latency table, the dwell/reach map, the error+correction model, and the rhythm (burst) parameters. Raw keystroke logs stay **on device** unless the user explicitly opts into uploading them for model improvement.
