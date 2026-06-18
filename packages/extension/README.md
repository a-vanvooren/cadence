# Cadence — Chrome extension (MV3 scaffold)

Holds the **command layer**, **profile storage**, and the **injector**. This is a
scaffold: `manifest.json` + a working reference Tier A injector (`src/inject.ts`).
The popup, background service worker, and Tier B (CDP) adapter are stubs to fill in.

## Flow

1. User triggers via popup, context menu, or the `type like me in <target>` command.
2. Background resolves the `TypeIntent` (target element, profile, cognitive load).
3. `@cadence/engine` `plan()` produces an `Action[]`.
4. The injector replays it into the focused field, with a floating **pause / stop / speed** HUD.

## Injection tiers (see ../../docs/phase-3-architecture.md §3.3)

- **Tier A — synthetic DOM events** (`src/inject.ts`): standard inputs, textareas,
  most contenteditable editors. Events are `isTrusted:false` — fine for the
  intended uses, and impossible to forge otherwise from this context.
- **Tier B — `chrome.debugger` / CDP** (stub): for canvas/hardened editors like
  Google Docs. Produces trusted events; requires the optional `debugger`
  permission and shows a browser banner. Opt-in per session.
- **Tier C — clipboard fallback**: when neither works, insert with a clear notice
  that pacing can't be simulated.

## Permissions rationale

- `storage` — save profiles locally (biometric-adjacent; treat like a password).
- `activeTab` + `scripting` — inject only into the tab the user acts on (no
  always-on content script).
- `debugger` (optional) — Tier B only, requested at the moment it's needed.
- `<all_urls>` is **optional** host permission, not default.

## Build

Intended toolchain: [`wxt`](https://wxt.dev) or CRXJS + Vite, TypeScript,
`@cadence/engine` as a workspace dependency. `pnpm dev` → load unpacked from the
build output.
