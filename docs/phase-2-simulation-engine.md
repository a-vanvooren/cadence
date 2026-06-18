# Phase 2 — The Simulation Engine & Context-Aware Variables

The engine takes three inputs — a **profile** (Phase 1), the **target text**, and a **context** (what kind of writing this is and where it's going) — and produces a **keystroke plan**: an ordered list of timed actions (`char`, `backspace`, `pause`, modifier presses) with millisecond delays. The plan is then handed to the injector (Phase 3).

Reference implementation lives in [`packages/engine`](../packages/engine). Everything below maps to code there.

## 2.0 Determinism, randomness, and the golden rule

All randomness flows through **one seeded PRNG** (`mulberry32`) so a given (profile, text, context, seed) reproduces an identical plan — essential for testing and for letting a user "re-roll" a take they didn't like. Human variation is modeled as **bounded Gaussian noise**, never uniform jitter. The golden rule of the whole engine:

> Every delay = a **base** value from the profile × **contextual multipliers** + **Gaussian noise**, clamped to plausible human bounds.

Uniform `random()*N` jitter is the #1 tell of a fake. Real inter-key intervals are roughly **log-normal** (a floor near your fastest possible transition, a long right tail of hesitations), so the engine samples inter-key delays from a log-normal/Gaussian-in-log-space distribution rather than a symmetric one.

## 2.1 Base timing model

For each character transition `c[i-1] → c[i]`:

```
delay = base_interkey
      × bigram_factor(c[i-1], c[i])     // from profile's bigram table; same-finger slower
      × reach_factor(c[i])              // distance from home row
      × lexical_factor(word)            // complexity of the word being entered
      × fatigue_factor(progress)        // decay over the whole block
      + shift_cost(c[i])                // capitalization / symbol modifier
      + gaussian_noise(σ from profile)
```

`base_interkey` is derived from baseline WPM: `60000 / (WPM × 5)` ms per char, then personalized by the profile's measured mean/variance.

## 2.2 Task-dependent cognitive pacing

Before timing characters, the engine **segments** the text and assigns *pre-segment* "thinking" pauses based on a **cognitive-load level** inferred from context (or set explicitly by the activation command).

| Load | Examples | Behavior |
|------|----------|----------|
| **Light** | chat message, quick reply, short email | Near-zero pre-sentence pauses; continuous bursts; the assistant "already knows what to say." |
| **Medium** | normal email, comment, notes | Modest pauses at sentence boundaries; occasional mid-clause hesitation. |
| **Heavy** | essay, research/analysis, anything with citations | Long pauses before new paragraphs/arguments; **5–15s** hesitations before a quoted/pasted block; mid-sentence "outlining" stalls. |

**Quote / paste boundaries (heavy load).** When the text contains a quotation, citation, or a block that reads as copied material (detected via quote marks, citation patterns like `(Author, 2021)`, URLs, or an explicit marker the LLM emits), the engine injects a **long pre-block pause** sampled from the heavy-load range (configurable, default 5–15s) to simulate *finding and switching to* the source. After the block it may add a short "returning to my own words" pause.

Pre-segment pauses are sampled per segment (Gaussian within the load's range), so they vary naturally rather than being a constant.

## 2.3 Physical fatigue decay

A monotonic decay applied across the whole block, keyed on cumulative characters typed:

```
fatigue_factor(n) = 1 + decayRate × (n / 1000)         // speed slows
error_rate(n)     = base_error × (1 + errorGrowth × (n / 1000))
```

- `decayRate` and `errorGrowth` come from the profile (conservative defaults if calibration was short).
- The effect is **gentle and capped** (e.g., max +25–35% slowdown) so long blocks drift realistically instead of grinding to a halt.
- A **recovery term** optionally partially resets fatigue after any long cognitive pause (you "rest" your hands while thinking), which is what real long-form typing looks like.

## 2.4 Human error & correction realism

Driven by the profile's error model. For each character, with probability `error_rate(progress)`:

1. **Pick a typo type** by the profile's weights:
   - **Adjacent substitution** — wrong neighbor key from the QWERTY spatial map (`a`→`s`, `n`→`m`).
   - **Transposition** — swap this char with the next (`th`→`ht`).
   - **Double letter** — accidental repeat.
   - **Dropped letter** — omit a char.
2. **Emit the wrong keystroke(s).**
3. **Decide when you notice**, using the profile's correction-latency distribution: immediately (next key), at end of word, or at end of clause. Keep typing wrong chars until the noticing point.
4. **Correct in your style:** single backspaces, backspace *spam*, `Ctrl/Option+Backspace` (whole word), or select-and-retype — chosen by the profile's correction-style weights. Each correction key has its own dwell + a short "realization" pause before the first backspace.
5. **Retype** the corrected text (which itself can, rarely, contain a fresh typo — humans do double-correct).

This is the single biggest contributor to perceived authenticity: *clean* typing reads as machine; the *texture of mistakes and how you fix them* reads as human.

## 2.5 Burstiness (micro-chunking)

Humans type in rhythmic bursts of ~3–5 words, pause to phrase the next chunk, and burst again. The engine groups the plan into bursts whose length (in words) is sampled from the profile's `burstLengthWords {mean, std}`. Between bursts it inserts an **inter-burst pause** (`interBurstPauseMs {mean, std}`), preferentially placed at natural phrase boundaries (after commas, conjunctions, prepositions) rather than mid-word. Within a burst, inter-key timing is tighter (you're "flowing"); the variance widens again at burst edges.

## 2.6 Lexical complexity delays

Before each word, a **micro-hesitation** scaled by the word's complexity:

```
lexical_factor(word) = 1 + k × complexity(word)
complexity(word) ≈ normalized(length, rarity, non-alpha density)
```

Rarity is approximated **on-device** with a small frequency list (top ~5–10k English words ≈ common → near-zero hesitation; everything else → progressively longer). Long, rare, or symbol-dense tokens (technical terms, URLs, code, names) get the largest pre-word pause. This mirrors the lexical-retrieval delay seen in real typing.

## 2.7 Punctuation & modifier delays

- **Capitalization:** entering a capital costs a `shift_cost` (engage Shift, hold, release) plus slightly longer dwell — drawn from the profile's measured Shift behavior, including left/right-Shift bias.
- **Terminal punctuation:** `.`, `?`, `!` get a short pause *after* (end-of-thought beat) and feed into the sentence-boundary pause used by cognitive pacing.
- **Mid-sentence punctuation:** `,`, `;`, `:` get a smaller beat, and are favored as burst boundaries.
- **Symbol reaches:** `@ # $ % & * ( )` etc. carry both a reach cost and a modifier cost, and are more error-prone (handled by the error model).

## 2.8 Putting it together

The engine composes these as a pipeline: `segment(text, context)` → assign cognitive pauses → for each segment, `tokenize → for each word: lexical pause → for each char: base×factors + error injection` → group into bursts with inter-burst pauses → apply fatigue across the running total. Output is a flat `Action[]` the injector can replay. See [`packages/engine/src/index.ts`](../packages/engine/src/index.ts).
