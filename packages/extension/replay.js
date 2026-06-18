// Shared injector. Serialized and run in the page by chrome.scripting.executeScript
// from both popup.js (button) and background.js (Whisper Mode hotkey).
//
// Locks onto the field focused at start and writes only there. In normal mode it
// shows a floating Stop/progress HUD and highlights the field + caret. In Whisper
// Mode (opts.whisper) it shows NO on-page markers — stop from the extension popup.
// Events are isTrusted:false by design (see docs/phase-3-architecture.md §3.3).
export function replayInPage(actions, opts) {
  opts = opts || {};
  const whisper = !!opts.whisper;

  const el = document.activeElement;
  const isField = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
  const isCE = el && el.isContentEditable;
  if (!el || (!isField && !isCE)) return { ok: false, reason: 'no-field' };

  const runId = Math.random().toString(36).slice(2) + Date.now();
  window.__cadenceRunId = runId;
  window.__cadenceStop = false; // popup Stop sets this true
  const stale = document.getElementById('cadence-hud');
  if (stale) stale.remove();

  let stopped = false;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- markers (skipped entirely in Whisper Mode) ----
  let hud = null;
  let label = null;
  let dot = null;
  let stopBtn = null;
  let prevStyle = null;

  if (!whisper) {
    hud = document.createElement('div');
    hud.id = 'cadence-hud';
    hud.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;background:#151926;color:#e8eaf0;border:1px solid #2a3142;border-radius:12px;padding:10px 12px;font:13px system-ui,-apple-system,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.45);display:flex;align-items:center;gap:10px';
    dot = document.createElement('span');
    dot.style.cssText = 'width:9px;height:9px;border-radius:50%;background:#4ad1c8;box-shadow:0 0 8px #4ad1c8';
    label = document.createElement('span');
    label.textContent = 'Cadence typing…';
    stopBtn = document.createElement('button');
    stopBtn.textContent = 'Stop';
    stopBtn.style.cssText = 'background:#f0808a;color:#0b0d13;border:none;border-radius:8px;padding:5px 12px;font:600 12px system-ui;cursor:pointer';
    stopBtn.addEventListener('click', () => { stopped = true; });
    hud.append(dot, label, stopBtn);
    document.body.appendChild(hud);

    prevStyle = { outline: el.style.outline, off: el.style.outlineOffset, caret: el.style.caretColor, shadow: el.style.boxShadow };
    el.style.outline = '2px solid #7c8cff';
    el.style.outlineOffset = '1px';
    el.style.caretColor = '#7c8cff';
    el.style.boxShadow = '0 0 0 4px rgba(124,140,255,.18)';
  }

  // ---- input/textarea helpers (write directly to el) ----
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

  // ---- contenteditable helpers (range-scoped to el) ----
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
    const p = n.nodeType === 3 ? n.previousSibling : n.childNodes[o - 1];
    if (p && p.nodeType === 3 && p.length) return p.data[p.length - 1];
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
    if (!prevStyle) return;
    el.style.outline = prevStyle.outline;
    el.style.outlineOffset = prevStyle.off;
    el.style.caretColor = prevStyle.caret;
    el.style.boxShadow = prevStyle.shadow;
  }
  function finish(msg) {
    restore();
    if (hud) {
      label.textContent = msg;
      dot.style.background = '#9aa3b2';
      dot.style.boxShadow = 'none';
      stopBtn.textContent = 'Close';
      stopBtn.onclick = () => hud.remove();
      setTimeout(() => { if (document.getElementById('cadence-hud') === hud) hud.remove(); }, 2500);
    }
  }
  const cancelled = () => stopped || window.__cadenceRunId !== runId || window.__cadenceStop === true;

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
        if (label) label.textContent = `Cadence typing… ${done}/${totalKeys}`;
      }
    }
    finish('Done');
    return { ok: true, stopped: false };
  })();
}
