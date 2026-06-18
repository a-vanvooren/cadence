# Phase 3 — Scalable Software Architecture & Implementation Framework

## 3.0 System overview

Four cleanly separated components, so each can ship and scale independently:

```
┌────────────────────┐     emits      ┌─────────────────────┐
│  Calibration App   │ ─────────────▶ │  Typing Profile     │
│  (web, Phase 1)    │   profile.json │  (portable, signed) │
└────────────────────┘                └──────────┬──────────┘
                                                  │ imported by
                                                  ▼
┌────────────────────┐  text+context  ┌─────────────────────┐  Action[]  ┌──────────────────┐
│  Command layer     │ ─────────────▶ │  Simulation Engine  │ ─────────▶ │  Injector        │
│  (parses intent)   │                │  (Phase 2, shared)  │            │  (per-target)    │
└────────────────────┘                └─────────────────────┘            └──────────────────┘
```

- **Calibration App** — a static web app (React/Svelte + Canvas/WebGL for the waveform). No server needed for capture; profiles are generated client-side.
- **Engine** — a framework-agnostic TypeScript package (`packages/engine`) shared by the app (for preview) and the extension (for execution). Pure functions, no DOM, fully testable.
- **Extension** — Chrome MV3. Holds the command layer + the injector + profile storage.

Recommended stack: **TypeScript everywhere**, **pnpm workspaces** monorepo, **Vite** for the app, **wxt** or **CRXJS** for the MV3 extension build, **Zod** for runtime profile validation against the JSON Schema.

## 3.1 The command interface

The activation command bridges LLM text generation and behavioral execution. Treat it as a small intent grammar, not free-form NLP.

**Trigger surfaces**
- The extension's own popup/side panel ("Type this as me → [target]").
- A slash/command syntax inside the assistant: `type like me in <target>: <what to write>`.
- A context-menu action on a focused field ("Insert as my typing").

**Parsed intent shape**
```ts
interface TypeIntent {
  action: 'type-as-me';
  target?: string;        // "Google Docs", "this field", a URL/host, or a CSS selector hint
  profileId: string;      // which saved profile (defaults to primary)
  load?: 'light'|'medium'|'heavy';  // explicit override of cognitive pacing
  text: string;           // the content to enter (from the LLM or clipboard)
  seed?: number;          // for reproducible re-rolls
}
```

**Pipeline**
1. **Capture intent.** Parse the command into `TypeIntent`. `target` is resolved to a concrete element: focused element → else best-match input on the named app/host → else ask the user to click the field. Cognitive `load` is inferred from the target + content (a Docs research doc ⇒ heavy; a chat box ⇒ light) unless the user states it.
2. **Generate text.** If `text` isn't supplied, the LLM produces it. The command layer is deliberately decoupled from *which* LLM — it just needs the final string + an optional structural hint (where quotes/citations are) to help cognitive pacing.
3. **Plan.** `engine.plan(text, profile, context)` → `Action[]`.
4. **Execute.** Hand the plan to the injector for the resolved target.
5. **User control.** A floating HUD shows progress with **pause / stop / speed** controls, because a human must be able to abort mid-type. Nothing types without an explicit user action that initiated it.

## 3.2 Profile serialization

A portable, versioned JSON document — the **behavioral map**. Full contract in [`schema/typing-profile.schema.json`](../schema/typing-profile.schema.json); example in [`schema/example-profile.json`](../schema/example-profile.json). Shape:

```jsonc
{
  "version": "1.0.0",
  "meta": { "id": "...", "createdAt": "...", "layout": "qwerty-us", "owner": "<account>" },
  "speed":     { "baseWpm": 78, "meanInterKeyMs": 138, "stdInterKeyMs": 46 },
  "bigrams":   { "th": 95, "he": 88, "in": 102, "er": 110, "...": 0 },
  "trigrams":  { "the": 250, "ing": 270 },
  "dwell":     { "meanMs": 92, "stdMs": 18, "perKeyReachMs": { "p": 14, "q": 22 } },
  "errors":    { "ratePer100": 3.1, "correctionStyle": {...}, "correctionDelayMs": {...}, "typoMix": {...} },
  "rhythm":    { "burstLengthWords": {"mean":4.2,"std":1.6}, "interBurstPauseMs": {"mean":420,"std":210} },
  "cognitive": { "lexicalHesitationMs": 180, "sentenceEndPauseMs": 650, "capShiftMs": 60 },
  "fatigue":   { "decayRatePerKChar": 0.12, "errorGrowthPerKChar": 0.15 }
}
```

Design choices:
- **Versioned** (`version`) so the engine can migrate older profiles.
- **Owner-stamped** (`meta.owner`) to support the consent guardrail in [ACCEPTABLE_USE.md](../ACCEPTABLE_USE.md).
- **Optionally signed** (detached signature / HMAC) so a profile's integrity and origin can be verified; this also deters silently editing a profile to impersonate someone.
- **Small** (a few KB) — aggregate statistics only, *not* raw keystroke logs. Raw logs never leave the device unless explicitly exported.
- **Privacy:** the profile is biometric-adjacent personal data. Store it locally (`chrome.storage.local` / IndexedDB), encrypt at rest if synced, and treat it under the same care as a password.

## 3.3 DOM injection & event simulation — the honest version

This is the hard part, and there's an important truth to state plainly up front:

> **You cannot forge `event.isTrusted === true` from a content script or page context.** Any `KeyboardEvent`/`InputEvent` your JavaScript dispatches is marked `isTrusted: false` by the browser. The *only* ways to produce genuinely trusted input events are (a) real hardware, or (b) a browser-/OS-level driver such as the **Chrome DevTools Protocol** `Input.dispatchKeyEvent`, reachable from an extension via the **`chrome.debugger`** API (which shows a visible "debugging this browser" banner). There is no general, silent way to make synthetic events indistinguishable from hardware — and the project does not pretend otherwise (see [ACCEPTABLE_USE.md](../ACCEPTABLE_USE.md)).

So the strategy is **tiered**, picking the lightest mechanism that actually works for the target:

### Tier A — Synthetic DOM events (default, works for most inputs)
For standard `<input>`, `<textarea>`, and many `contenteditable` editors, replay each planned keystroke as a faithful event *sequence* that frameworks expect:

```
keydown → beforeinput → (update value) → input → keyup
```

with correct `key`, `code`, `keyCode`/`which` (legacy but still read by some libs), `location`, and modifier state. Critical details that trip people up:

- **React/Vue controlled inputs** ignore a directly assigned `.value` because they track the value internally. Use the **native value setter** (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, v)`) *then* dispatch `input` with `{ bubbles: true }`, so React's synthetic-event layer sees the change. The reference injector does this.
- Use **`InputEvent`** (`inputType: 'insertText'`, `data: char`) for `beforeinput`/`input`, not just `KeyboardEvent` — modern editors key off `beforeinput`.
- Maintain a real **selection/caret** via the Selection API for `contenteditable`.
- Fire `compositionstart/update/end` when emulating IME-like insertion if the editor expects it.

Tier A covers the majority of "type into a field on a website" cases. Its events are `isTrusted:false`, which is fine for the intended uses (your own fields, accessibility, authorized testing).

### Tier B — `chrome.debugger` / CDP (for hardened or canvas editors)
Some targets defeat Tier A:
- **Google Docs** renders to a **canvas** and intercepts input at a low level; synthetic DOM events on the page don't reliably reach it.
- Editors that explicitly check `isTrusted` or use complex internal models.

For these, the extension attaches the **`chrome.debugger`** API to the tab and uses CDP `Input.dispatchKeyEvent` / `Input.insertText`, which produces **trusted** events at the browser input layer. Tradeoffs to be honest about: requires the `"debugger"` permission, shows a conspicuous banner to the user, and is heavier. It is opt-in per session and surfaced clearly in the UI.

### Tier C — Fallback
If neither works (locked-down field, cross-origin iframe you can't script), degrade gracefully: offer a clipboard insert with a clear notice that pacing can't be simulated, rather than silently doing nothing.

### Injector architecture
A small **adapter registry** keyed by host/editor signature picks the tier and any site-specific quirks:

```ts
interface InjectorAdapter {
  matches(el: Element, host: string): boolean;
  type(plan: Action[], el: Element, signal: AbortSignal): Promise<void>;
}
```

Ship adapters for: generic input/textarea, generic contenteditable (ProseMirror/Slate/Lexical/Quill heuristics), and a CDP adapter for canvas/hardened editors. The plan replay loop just awaits each action's delay (`await sleep(action.delayMs)`), respecting the `AbortSignal` from the HUD's stop button.

### MV3 wiring
- **Manifest v3**, service-worker background. `host_permissions` requested narrowly / via `activeTab` + optional permissions rather than `<all_urls>` by default.
- **Content script** does Tier A injection and HUD; **background** holds profiles and brokers the optional `chrome.debugger` (Tier B) attach.
- **Message passing** carries the `Action[]` plan from background to content script (or the content script imports the engine directly and just receives the resolved `TypeIntent`).
- Skeleton in [`packages/extension`](../packages/extension).

## 3.4 Scaling & product concerns

- **All planning is client-side / on-device** — no server in the hot path, so it scales trivially and keeps biometric data local.
- **Optional account sync** (encrypted profiles) is the only backend, and it's a simple authenticated blob store.
- **Telemetry** (opt-in) should be aggregate quality metrics, never raw keystrokes.
- **Cross-browser:** the engine is portable; a Firefox MV3 / Safari Web Extension build is mostly a matter of the injector + manifest layer.
