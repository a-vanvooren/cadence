/**
 * Tier A reference injector (runs in the page/content-script context).
 *
 * Replays an engine `Action[]` into a standard <input>, <textarea>, or
 * contenteditable using synthetic DOM events fired in the order modern
 * frameworks expect: keydown → beforeinput → (value mutation) → input → keyup.
 *
 * IMPORTANT (see docs/phase-3-architecture.md §3.3): events dispatched from here
 * are `isTrusted: false`. That is a property of the web platform you cannot forge
 * from this context. For canvas-based or hardened editors (e.g. Google Docs) use
 * the Tier B chrome.debugger / CDP path, which produces trusted events at the
 * cost of a visible "debugging this browser" banner and the `debugger` permission.
 */
import type { Action } from '@cadence/engine';

type EditableEl = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Typing aborted', 'AbortError'));
      },
      { once: true },
    );
  });

/** Best-effort `code` for a character (enough for most listeners). */
function codeFor(ch: string): string {
  if (/[a-zA-Z]/.test(ch)) return `Key${ch.toUpperCase()}`;
  if (/[0-9]/.test(ch)) return `Digit${ch}`;
  if (ch === ' ') return 'Space';
  if (ch === '\n') return 'Enter';
  return 'Unidentified';
}

function dispatchKey(el: EditableEl, type: 'keydown' | 'keyup', char: string, shift: boolean) {
  el.dispatchEvent(
    new KeyboardEvent(type, {
      key: char === '\n' ? 'Enter' : char,
      code: codeFor(char),
      shiftKey: shift,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** Set value on a controlled (React/Vue) input so the framework notices. */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

function isFormField(el: EditableEl): el is HTMLInputElement | HTMLTextAreaElement {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

/** Insert `text` at the caret (or replace selection) for an <input>/<textarea>. */
function insertIntoField(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const next = el.value.slice(0, start) + text + el.value.slice(end);
  setNativeValue(el, next);
  const caret = start + text.length;
  el.setSelectionRange(caret, caret);
}

function deleteFromField(el: HTMLInputElement | HTMLTextAreaElement, count: number) {
  const start = el.selectionStart ?? el.value.length;
  const from = Math.max(0, start - count);
  const next = el.value.slice(0, from) + el.value.slice(start);
  setNativeValue(el, next);
  el.setSelectionRange(from, from);
}

/** One backspace's worth of "word" for Ctrl/Option+Backspace. */
function wordDeleteCount(el: HTMLInputElement | HTMLTextAreaElement): number {
  const start = el.selectionStart ?? el.value.length;
  const before = el.value.slice(0, start);
  const m = before.match(/(\s*\S+)$/);
  return m ? m[0].length : 1;
}

function applyToContentEditable(action: Action, el: HTMLElement) {
  // contenteditable editors mostly key off beforeinput/input + execCommand.
  el.dispatchEvent(new InputEvent('beforeinput', { inputType: inputTypeFor(action), data: dataFor(action), bubbles: true, cancelable: true }));
  if (action.type === 'key') document.execCommand('insertText', false, action.char);
  else if (action.type === 'backspace') document.execCommand('delete', false);
  else if (action.type === 'deleteWord') document.execCommand('deleteWordBackward', false);
  el.dispatchEvent(new InputEvent('input', { inputType: inputTypeFor(action), data: dataFor(action), bubbles: true }));
}

function inputTypeFor(a: Action): string {
  if (a.type === 'key') return 'insertText';
  if (a.type === 'deleteWord') return 'deleteWordBackward';
  return 'deleteContentBackward';
}
function dataFor(a: Action): string | null {
  return a.type === 'key' ? a.char : null;
}

/**
 * Replay a plan into `el`, awaiting each action's delay and honoring `signal`.
 * Returns when the whole plan has played or rejects with AbortError if stopped.
 */
export async function replayPlan(actions: Action[], el: EditableEl, signal?: AbortSignal): Promise<void> {
  el.focus();
  for (const action of actions) {
    await sleep(action.delayMs, signal);

    if (action.type === 'pause') continue;

    if (isFormField(el)) {
      if (action.type === 'key') {
        dispatchKey(el, 'keydown', action.char, !!action.shift);
        el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: action.char, bubbles: true, cancelable: true }));
        insertIntoField(el, action.char);
        el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: action.char, bubbles: true }));
        dispatchKey(el, 'keyup', action.char, !!action.shift);
      } else if (action.type === 'backspace') {
        dispatchKey(el, 'keydown', 'Backspace', false);
        deleteFromField(el, 1);
        el.dispatchEvent(new InputEvent('input', { inputType: 'deleteContentBackward', bubbles: true }));
        dispatchKey(el, 'keyup', 'Backspace', false);
      } else if (action.type === 'deleteWord') {
        deleteFromField(el, wordDeleteCount(el));
        el.dispatchEvent(new InputEvent('input', { inputType: 'deleteWordBackward', bubbles: true }));
      }
    } else {
      applyToContentEditable(action, el);
    }
  }
}
