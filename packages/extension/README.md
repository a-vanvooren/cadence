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

### Tips / troubleshooting

- **"No editable field was focused."** Click into the text box first, then open the
  popup and press Type it. (Opening the popup doesn't change the page's focused
  field, but clicking elsewhere on the page does.)
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
| `manifest.json` | MV3 manifest (`activeTab` + `scripting`, popup only) |
| `popup.html` / `popup.css` | The control panel UI |
| `popup.js` | Plans keystrokes with the engine, injects + replays them in the active tab |
| `engine.js` | Plain-JS port of `@cadence/engine` (`plan()`) |
| `default-profile.js` | Bundled example profile (swap for a real one later) |

No permissions beyond `activeTab` + `scripting`: it only touches the tab you're on
when you click Type it. No always-on content script, no host permissions.

## Production path (later)

`src/inject.ts` is the typed reference injector. A real build (e.g. [`wxt`](https://wxt.dev)
or CRXJS + Vite) would: import `@cadence/engine` directly, load the user's
calibrated profile from `chrome.storage`, add a floating pause/stop/speed HUD, and
add the **Tier B** `chrome.debugger`/CDP adapter for canvas/hardened editors. See
[../../docs/phase-3-architecture.md](../../docs/phase-3-architecture.md) §3.3.
