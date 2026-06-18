import { plan } from './engine.js';
import { DEFAULT_PROFILE } from './default-profile.js';

const $ = (id) => document.getElementById(id);
const setStatus = (s) => { $('status').textContent = s; };

let activeProfile = DEFAULT_PROFILE;
let hasProfile = false;

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
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const { cadenceProfile } = await chrome.storage.local.get('cadenceProfile');
      if (cadenceProfile) { activeProfile = cadenceProfile; hasProfile = true; }
    }
  } catch { /* fall back to example */ }
  updateProfileUI();
}
loadProfile();

$('calibrate').addEventListener('click', () => {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  }
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

$('go').addEventListener('click', async () => {
  const text = $('text').value;
  if (!text.trim()) {
    setStatus('Enter some text first.');
    return;
  }

  const load = $('load').value;
  const speed = parseFloat($('speed').value);

  const { actions, estimatedMs } = plan(text, activeProfile, {
    load,
    seed: Date.now() & 0x7fffffff,
  });

  const scaled = actions.map((a) => ({ ...a, delayMs: Math.max(0, a.delayMs * speed) }));

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    setStatus('No active tab found.');
    return;
  }

  setStatus(`Typing ~${((estimatedMs * speed) / 1000).toFixed(1)}s… use the Stop button on the page.`);

  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: replayInPage,
      args: [scaled],
    });
    const r = res && res.result;
    if (r && r.ok === false) {
      setStatus('Click into a text field on the page first, then press “Type it”.');
    }
  } catch (e) {
    setStatus('Error: ' + (e && e.message ? e.message : String(e)));
  }
});

/**
 * Serialized + run in the page. Locks onto the field focused at start, shows a
 * floating Stop/progress HUD that survives the popup closing, tints the caret +
 * highlights the field, and writes only to the locked element (so clicking
 * elsewhere doesn't redirect the typing). Events are isTrusted:false by design.
 */
function replayInPage(actions) {
  const el = document.activeElement;
  const isField = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
  const isCE = el && el.isContentEditable;
  if (!el || (!isField && !isCE)) return { ok: false, reason: 'no-field' };

  // Cancel any previous run + clear a stale HUD.
  const runId = Math.random().toString(36).slice(2) + Date.now();
  window.__cadenceRunId = runId;
  const stale = document.getElementById('cadence-hud');
  if (stale) stale.remove();

  let stopped = false;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- floating HUD ----
  const hud = document.createElement('div');
  hud.id = 'cadence-hud';
  hud.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;background:#151926;color:#e8eaf0;border:1px solid #2a3142;border-radius:12px;padding:10px 12px;font:13px system-ui,-apple-system,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.45);display:flex;align-items:center;gap:10px';
  const dot = document.createElement('span');
  dot.style.cssText = 'width:9px;height:9px;border-radius:50%;background:#4ad1c8;box-shadow:0 0 8px #4ad1c8';
  const label = document.createElement('span');
  label.textContent = 'Cadence typing…';
  const stopBtn = document.createElement('button');
  stopBtn.textContent = 'Stop';
  stopBtn.style.cssText = 'background:#f0808a;color:#0b0d13;border:none;border-radius:8px;padding:5px 12px;font:600 12px system-ui;cursor:pointer';
  stopBtn.addEventListener('click', () => { stopped = true; });
  hud.append(dot, label, stopBtn);
  document.body.appendChild(hud);

  // ---- highlight target field + colored caret ----
  const prev = { outline: el.style.outline, off: el.style.outlineOffset, caret: el.style.caretColor, shadow: el.style.boxShadow };
  el.style.outline = '2px solid #7c8cff';
  el.style.outlineOffset = '1px';
  el.style.caretColor = '#7c8cff';
  el.style.boxShadow = '0 0 0 4px rgba(124,140,255,.18)';

  // ---- input/textarea helpers (write directly to el, focus-independent) ----
  function setNativeValue(elem, value) {
    const proto = elem.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const d = Object.getOwnPropertyDescriptor(proto, 'value');
    if (d && d.set) d.set.call(elem, value);
    else elem.value = value;
  }
  function codeFor(ch) {
    if (/[a-zA-Z]/.test(ch)) return 'Key' + ch.toUpperCase();
    if (/[0-9]/.test(ch)) return 'Digit' + ch;
    if (ch === ' ') return 'Space';
    if (ch === '\n') return 'Enter';
    return 'Unidentified';
  }
  function key(type, ch, shift) {
    el.dispatchEvent(new KeyboardEvent(type, { key: ch === '\n' ? 'Enter' : ch, code: codeFor(ch), shiftKey: !!shift, bubbles: true, cancelable: true }));
  }
  function fieldInsert(t) {
    const s = el.selectionStart ?? el.value.length;
    const e = el.selectionEnd ?? el.value.length;
    setNativeValue(el, el.value.slice(0, s) + t + el.value.slice(e));
    const c = s + t.length;
    try { el.setSelectionRange(c, c); } catch { /* unsupported input type */ }
  }
  function fieldDelete(n) {
    const s = el.selectionStart ?? el.value.length;
    const from = Math.max(0, s - n);
    setNativeValue(el, el.value.slice(0, from) + el.value.slice(s));
    try { el.setSelectionRange(from, from); } catch { /* noop */ }
  }
  function wordDeleteCount() {
    const s = el.selectionStart ?? el.value.length;
    const m = el.value.slice(0, s).match(/(\s*\S+)$/);
    return m ? m[0].length : 1;
  }

  // ---- contenteditable helpers (range-scoped to el, never touches selection) ----
  let ceRange = null;
  if (isCE) {
    ceRange = document.createRange();
    ceRange.selectNodeContents(el);
    ceRange.collapse(false);
  }
  function charBefore() {
    const n = ceRange.startContainer;
    const o = ceRange.startOffset;
    if (n.nodeType === 3 && o > 0) return n.data[o - 1];
    const prevNode = n.nodeType === 3 ? n.previousSibling : n.childNodes[o - 1];
    if (prevNode && prevNode.nodeType === 3 && prevNode.length) return prevNode.data[prevNode.length - 1];
    return '';
  }
  function ceInsert(ch) {
    el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: ch, bubbles: true, cancelable: true }));
    const tn = document.createTextNode(ch);
    ceRange.insertNode(tn);
    ceRange.setStartAfter(tn);
    ceRange.collapse(true);
    el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: ch, bubbles: true }));
  }
  function ceBackspace() {
    const n = ceRange.startContainer;
    const o = ceRange.startOffset;
    if (n.nodeType === 3 && o > 0) {
      n.deleteData(o - 1, 1);
      ceRange.setStart(n, o - 1);
      ceRange.collapse(true);
    } else {
      const p = n.nodeType === 3 ? n.previousSibling : n.childNodes[o - 1];
      if (p && p.nodeType === 3 && p.length) {
        p.deleteData(p.length - 1, 1);
        ceRange.setStart(p, p.length);
        ceRange.collapse(true);
      }
    }
    el.dispatchEvent(new InputEvent('input', { inputType: 'deleteContentBackward', bubbles: true }));
  }
  function ceWordDelete() {
    let g = 0;
    while (charBefore() === ' ' && g++ < 6) ceBackspace();
    while (charBefore() && charBefore() !== ' ' && g++ < 40) ceBackspace();
  }

  el.focus();

  const totalKeys = actions.filter((a) => a.type === 'key').length;
  let done = 0;

  function restore() {
    el.style.outline = prev.outline;
    el.style.outlineOffset = prev.off;
    el.style.caretColor = prev.caret;
    el.style.boxShadow = prev.shadow;
  }
  function finish(msg) {
    restore();
    label.textContent = msg;
    dot.style.background = '#9aa3b2';
    dot.style.boxShadow = 'none';
    stopBtn.textContent = 'Close';
    stopBtn.onclick = () => hud.remove();
    setTimeout(() => { if (document.getElementById('cadence-hud') === hud) hud.remove(); }, 2500);
  }
  const cancelled = () => stopped || window.__cadenceRunId !== runId;

  return (async () => {
    for (const a of actions) {
      if (cancelled()) { finish('Stopped'); return { ok: true, stopped: true }; }
      await sleep(a.delayMs);
      if (cancelled()) { finish('Stopped'); return { ok: true, stopped: true }; }
      if (a.type === 'pause') continue;

      if (isField) {
        if (a.type === 'key') {
          key('keydown', a.char, a.shift);
          el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: a.char, bubbles: true, cancelable: true }));
          fieldInsert(a.char);
          el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: a.char, bubbles: true }));
          key('keyup', a.char, a.shift);
        } else if (a.type === 'backspace') {
          key('keydown', 'Backspace', false);
          fieldDelete(1);
          el.dispatchEvent(new InputEvent('input', { inputType: 'deleteContentBackward', bubbles: true }));
          key('keyup', 'Backspace', false);
        } else if (a.type === 'deleteWord') {
          fieldDelete(wordDeleteCount());
          el.dispatchEvent(new InputEvent('input', { inputType: 'deleteWordBackward', bubbles: true }));
        }
      } else {
        if (a.type === 'key') ceInsert(a.char);
        else if (a.type === 'backspace') ceBackspace();
        else if (a.type === 'deleteWord') ceWordDelete();
      }

      if (a.type === 'key') {
        done++;
        label.textContent = `Cadence typing… ${done}/${totalKeys}`;
      }
    }
    finish('Done');
    return { ok: true, stopped: false };
  })();
}
