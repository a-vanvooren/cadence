# Cadence — Chrome extension

Two things live here:

1. **A working, no-build MVP** you can load into Chrome right now (plain JS).
2. **Production-path notes** (`src/inject.ts`, TypeScript) for when you wire up a
   real bundler + the calibration profile + Tier B (CDP) injection.

## Run the MVP (no Node, no build, ~1 minute)

1. Open Chrome → go to `chrome://extensions`.
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked** and select this folder:
   `C:\Users\vanvo\OneDrive\Desktop\Typing_DNA\packages\extension`
4. Open any page with a text box (e.g. a Google search box, an email body, a
   `<textarea>` on a test page).
5. **Click into that text box** so the cursor is in it.
6. Click the **Cadence** icon in the toolbar → paste some text → choose a load
   (start with *Light*) → **Type it**.

You'll watch it type character-by-character with human timing, occasional typos,
backspace/word-delete corrections, burst pauses, and (on *Heavy*) longer thinking
gaps. Each run uses a fresh random seed, so no two takes are identical.

## Calibrate it to *your* typing

Out of the box the popup uses a bundled example profile. To make it type like
**you**:

1. Open the popup → click **Calibrate your typing →** (or right-click the
   extension icon → **Options**). It opens a full-page "Tuning Room" in a new tab.
2. Do the short typing prompts (~3 min). A live waveform shows your rhythm as you go.
3. On the results screen, click **Save & use this profile**.

Your profile is derived on-device (speed, keystroke gaps, key-hold time,
per-pair bigram latencies, error rate + how you correct, and burst rhythm) and
stored in `chrome.storage.local`. The popup picks it up automatically — the footer
will switch from "Profile: example" to "Profile: yours". You can also **Download
JSON** to keep a copy. Raw keystrokes never leave your machine.

### Controls

- **Stop button** — while typing, a small floating panel appears on the page
  (top-right) with live progress and a **Stop** button. It stays put even if the
  popup closes, so you can stop mid-type and change your text.
- **It stays where you put it** — Cadence locks onto the field that was focused
  when you pressed *Type it* and keeps writing there. You can click into other
  fields / do other things while it types.
- **Colored cursor** — the target field is highlighted and its caret is tinted
  while typing, so you can see where (and when) it's entering text.

### Whisper Mode (discreet, hands-free)

Toggle **Whisper Mode** in the popup. The popup shifts to a quieter, darker skin and:

- **No on-screen markers** — no field highlight, caret tint, or Stop HUD.
- **Clipboard hotkey** — focus a field and press **Ctrl+Shift+Y** (Mac: ⌘+Shift+Y)
  to type your latest clipboard contents at the cursor, without opening the popup.
  (The background worker reads the clipboard, plans with your profile + saved
  Load/Speed, and types.)
- **Stop from the extension** — with no on-page Stop button, open the popup and
  press **Stop**.

Rebind the shortcut at `chrome://extensions/shortcuts`; the popup shows the current
binding. If the clipboard read is blocked (an unfocused or restricted page), the
toolbar badge flashes `∅` — focus the page and try again, or use the popup.

### Profile management (in the popup footer)

- With no profile: shows **"Calibrate your typing →"**.
- With a saved profile: shows **"Recalibrate →"** (overwrites the old one) plus a
  **Delete** button that reverts to the bundled example profile.

### Tips / troubleshooting

- **"Click into a text field first."** Click into the text box, then open the
  popup and press Type it. (Opening the popup doesn't change the page's focused
  field, but clicking elsewhere on the page does — so focus the field last.)
- **Heavy load feels slow.** That's intentional (it simulates thinking). Use the
  **Speed 0.3×** option while testing.
- **Google Docs does nothing.** Expected — Docs renders to a canvas and ignores
  synthetic DOM events. That needs the Tier B `chrome.debugger`/CDP path (not in
  this MVP). Regular inputs, textareas, and most rich editors work.
- After editing any file here, hit the **refresh ⟳** icon on the card in
  `chrome://extensions` to reload.

## What's in the MVP

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest (permissions, command, background, icons) |
| `popup.html` / `popup.css` | The control panel UI (incl. the Whisper Mode skin) |
| `popup.js` | Loads profile/settings, plans keystrokes, injects the replay, Stop |
| `background.js` | Service worker: the Whisper Mode clipboard hotkey |
| `replay.js` | Shared injector (used by popup + background); HUD, target lock, caret |
| `engine.js` | Plain-JS port of `@cadence/engine` (`plan()`) |
| `default-profile.js` | Bundled example profile (used until you calibrate) |
| `calibrate.html` / `calibrate.css` / `calibrate.js` | The in-extension "Tuning Room" options page |
| `profile-derive.js` | Turns captured keystrokes into a saved profile |
| `icons/` | Brand mark — PNG toolbar icons (16/32/48/128) + `logo.svg` for the UI |

Permissions: `activeTab` + `scripting` (touch only the tab you act on),
`storage` (save your profile/settings locally), and `clipboardRead` (Whisper
Mode hotkey). No always-on content script; `<all_urls>` is not requested.

## Production path (later)

`src/inject.ts` is the typed reference injector. A real build (e.g. [`wxt`](https://wxt.dev)
or CRXJS + Vite) would: import `@cadence/engine` directly, load the user's
calibrated profile from `chrome.storage`, add a floating pause/stop/speed HUD, and
add the **Tier B** `chrome.debugger`/CDP adapter for canvas/hardened editors. See
[../../docs/phase-3-architecture.md](../../docs/phase-3-architecture.md) §3.3.
