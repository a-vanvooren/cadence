import { plan } from './engine.js';
import { DEFAULT_PROFILE } from './default-profile.js';

const $ = (id) => document.getElementById(id);
const setStatus = (s) => { $('status').textContent = s; };

$('go').addEventListener('click', async () => {
  const text = $('text').value;
  if (!text.trim()) {
    setStatus('Enter some text first.');
    return;
  }

  const load = $('load').value;
  const speed = parseFloat($('speed').value);

  const { actions, estimatedMs } = plan(text, DEFAULT_PROFILE, {
    load,
    seed: Date.now() & 0x7fffffff,
  });

  // Scale every delay so heavy/long takes don't crawl during testing.
  const scaled = actions.map((a) => ({ ...a, delayMs: Math.max(0, a.delayMs * speed) }));

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    setStatus('No active tab found.');
    return;
  }

  $('go').disabled = true;
  setStatus(`Typing ${actions.length} keystrokes (~${((estimatedMs * speed) / 1000).toFixed(1)}s)…`);

  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: replayInPage,
      args: [scaled],
    });
    const ok = res && res.result;
    setStatus(ok === true
      ? 'Done.'
      : 'No editable field was focused. Click into a text box on the page, then press “Type it”.');
  } catch (e) {
    setStatus('Error: ' + (e && e.message ? e.message : String(e)));
  } finally {
    $('go').disabled = false;
  }
});

/**
 * Serialized and executed in the page (isolated world). Self-contained — it can
 * only reference its own argument and page globals. Replays the keystroke plan
 * into the currently focused <input>/<textarea>/contenteditable.
 *
 * NOTE: events dispatched here are isTrusted:false (see docs/phase-3 §3.3).
 */
async function replayInPage(actions) {
  const el = document.activeElement;
  const isField = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
  const isCE = el && el.isContentEditable;
  if (!el || (!isField && !isCE)) return false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function setNativeValue(elem, value) {
    const proto = elem.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(elem, value);
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
    el.dispatchEvent(new KeyboardEvent(type, {
      key: ch === '\n' ? 'Enter' : ch,
      code: codeFor(ch),
      shiftKey: !!shift,
      bubbles: true,
      cancelable: true,
    }));
  }
  function fieldInsert(t) {
    const s = el.selectionStart ?? el.value.length;
    const e = el.selectionEnd ?? el.value.length;
    setNativeValue(el, el.value.slice(0, s) + t + el.value.slice(e));
    const c = s + t.length;
    el.setSelectionRange(c, c);
  }
  function fieldDelete(count) {
    const s = el.selectionStart ?? el.value.length;
    const from = Math.max(0, s - count);
    setNativeValue(el, el.value.slice(0, from) + el.value.slice(s));
    el.setSelectionRange(from, from);
  }
  function wordDeleteCount() {
    const s = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, s);
    const m = before.match(/(\s*\S+)$/);
    return m ? m[0].length : 1;
  }

  el.focus();
  for (const a of actions) {
    await sleep(a.delayMs);
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
      // contenteditable: execCommand is deprecated but still the simplest path.
      if (a.type === 'key') {
        el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: a.char, bubbles: true, cancelable: true }));
        document.execCommand('insertText', false, a.char);
      } else if (a.type === 'backspace') {
        document.execCommand('delete', false);
      } else if (a.type === 'deleteWord') {
        document.execCommand('deleteWordBackward', false);
      }
    }
  }
  return true;
}
