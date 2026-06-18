// Background service worker. Handles the Whisper Mode keyboard shortcut:
// read the latest clipboard text → plan it with the active profile → type it
// into the focused field of the active tab.
import { plan } from './engine.js';
import { DEFAULT_PROFILE } from './default-profile.js';
import { replayInPage } from './replay.js';

async function loadState() {
  const { cadenceProfile, cadenceSettings } = await chrome.storage.local.get(['cadenceProfile', 'cadenceSettings']);
  return {
    profile: cadenceProfile || DEFAULT_PROFILE,
    settings: Object.assign({ load: 'light', speed: 1, whisper: false }, cadenceSettings || {}),
  };
}

async function flashBadge(tabId, text, color) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: color || '#7c8cff' });
    await chrome.action.setBadgeText({ tabId, text });
    setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }), 1600);
  } catch { /* tab may be gone */ }
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'type-clipboard') return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  // Read the clipboard from the page (needs clipboardRead + a focused page).
  let clip = '';
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => navigator.clipboard.readText().catch(() => ''),
    });
    clip = (res && res.result) || '';
  } catch {
    clip = '';
  }

  if (!clip.trim()) {
    await flashBadge(tab.id, '∅', '#f0808a'); // empty / blocked clipboard
    return;
  }

  const { profile, settings } = await loadState();
  const { actions } = plan(clip, profile, { load: settings.load, seed: Date.now() & 0x7fffffff });
  const speed = settings.speed || 1;
  const scaled = actions.map((a) => ({ ...a, delayMs: Math.max(0, a.delayMs * speed) }));

  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: replayInPage,
      args: [scaled, { whisper: settings.whisper }],
    });
    if (res && res.result && res.result.ok === false) {
      await flashBadge(tab.id, '!', '#f0b35b'); // no editable field focused
    }
  } catch {
    await flashBadge(tab.id, '!', '#f0808a');
  }
});
