import { plan } from './engine.js';
import { DEFAULT_PROFILE } from './default-profile.js';
import { replayInPage } from './replay.js';

const $ = (id) => document.getElementById(id);
const setStatus = (s) => { $('status').textContent = s; };

let activeProfile = DEFAULT_PROFILE;
let hasProfile = false;

// ---- profile ----
function updateProfileUI() {
  if (hasProfile) {
    $('profile-info').textContent = `Profile: yours (${activeProfile.speed.baseWpm} WPM)`;
    $('calibrate').textContent = 'Recalibrate →';
    $('delete').hidden = false;
  } else {
    $('profile-info').textContent = 'Profile: example';
    $('calibrate').textContent = 'Calibrate your typing →';
    $('delete').hidden = true;
  }
}

async function loadProfile() {
  try {
    if (chrome.storage && chrome.storage.local) {
      const { cadenceProfile } = await chrome.storage.local.get('cadenceProfile');
      if (cadenceProfile) { activeProfile = cadenceProfile; hasProfile = true; }
    }
  } catch { /* example */ }
  updateProfileUI();
}

// ---- settings (shared with the Whisper hotkey in the background worker) ----
function applyWhisperSkin(on) {
  document.body.classList.toggle('whisper', on);
  $('whisper-hint').hidden = !on;
}

async function loadSettings() {
  let s = { load: 'light', speed: 1, whisper: false };
  try {
    const { cadenceSettings } = await chrome.storage.local.get('cadenceSettings');
    if (cadenceSettings) s = { ...s, ...cadenceSettings };
  } catch { /* defaults */ }
  $('load').value = s.load;
  $('speed').value = String(s.speed);
  $('whisper').checked = s.whisper;
  applyWhisperSkin(s.whisper);
}

async function saveSettings() {
  const s = { load: $('load').value, speed: parseFloat($('speed').value), whisper: $('whisper').checked };
  applyWhisperSkin(s.whisper);
  try { await chrome.storage.local.set({ cadenceSettings: s }); } catch { /* noop */ }
}

async function showHotkey() {
  try {
    if (chrome.commands && chrome.commands.getAll) {
      const cmds = await chrome.commands.getAll();
      const c = cmds.find((x) => x.name === 'type-clipboard');
      $('hotkey').textContent = c && c.shortcut ? c.shortcut : 'unset — set at chrome://extensions/shortcuts';
    }
  } catch { /* keep default label */ }
}

loadProfile();
loadSettings();
showHotkey();

$('load').addEventListener('change', saveSettings);
$('speed').addEventListener('change', saveSettings);
$('whisper').addEventListener('change', saveSettings);

$('calibrate').addEventListener('click', () => {
  if (chrome.runtime && chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
});

$('delete').addEventListener('click', async () => {
  try {
    await chrome.storage.local.remove('cadenceProfile');
    activeProfile = DEFAULT_PROFILE;
    hasProfile = false;
    updateProfileUI();
    setStatus('Profile deleted — back to the example profile.');
  } catch (e) {
    setStatus('Delete failed: ' + (e && e.message ? e.message : String(e)));
  }
});

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab && tab.id ? tab : null;
}

$('go').addEventListener('click', async () => {
  const text = $('text').value;
  if (!text.trim()) { setStatus('Enter some text first.'); return; }

  const { actions, estimatedMs } = plan(text, activeProfile, {
    load: $('load').value,
    seed: Date.now() & 0x7fffffff,
  });
  const speed = parseFloat($('speed').value);
  const scaled = actions.map((a) => ({ ...a, delayMs: Math.max(0, a.delayMs * speed) }));

  const tab = await activeTab();
  if (!tab) { setStatus('No active tab found.'); return; }

  setStatus(`Typing ~${((estimatedMs * speed) / 1000).toFixed(1)}s…`);
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: replayInPage,
      args: [scaled, { whisper: $('whisper').checked }],
    });
    if (res && res.result && res.result.ok === false) {
      setStatus('Click into a text field on the page first, then press “Type it”.');
    }
  } catch (e) {
    setStatus('Error: ' + (e && e.message ? e.message : String(e)));
  }
});

$('stop').addEventListener('click', async () => {
  const tab = await activeTab();
  if (!tab) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => { window.__cadenceStop = true; },
    });
    setStatus('Stopped.');
  } catch (e) {
    setStatus('Stop failed: ' + (e && e.message ? e.message : String(e)));
  }
});
