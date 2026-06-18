// Derives a TypingProfile from raw captured keystroke events.
// Starts from DEFAULT_PROFILE as a fallback base and overwrites each field only
// when there's enough signal to estimate it, so the result is always complete
// and schema-valid even from a short, sparse calibration.
import { DEFAULT_PROFILE } from './default-profile.js';

const IK_CAP = 2000;      // ignore gaps above this for *base* timing (they're pauses)
const DWELL_CAP = 400;    // ignore held keys
const BURST_GAP = 500;    // gap above this splits a typing burst

// ---- small stats helpers ----
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const std = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const isPrintable = (e) => e.type === 'down' && e.key && e.key.length === 1;

/** Printable keydowns of a step, time-sorted. */
function downs(events) {
  return events.filter(isPrintable).sort((a, b) => a.t - b.t);
}

/** Consecutive inter-key intervals for a step (optionally capped). */
function intervals(events, cap = Infinity) {
  const d = downs(events);
  const out = [];
  for (let i = 1; i < d.length; i++) {
    const dt = d[i].t - d[i - 1].t;
    if (dt > 0 && dt <= cap) out.push(dt);
  }
  return out;
}

function deriveSpeed(allEvents) {
  const iks = allEvents.flatMap((ev) => intervals(ev, IK_CAP));
  if (iks.length < 20) return null;
  const meanInterKeyMs = mean(iks);
  return {
    baseWpm: clamp(Math.round(60000 / (meanInterKeyMs * 5)), 5, 250),
    meanInterKeyMs: Math.round(meanInterKeyMs),
    stdInterKeyMs: Math.round(std(iks)),
  };
}

function deriveDwell(allEvents) {
  const samples = [];
  for (const events of allEvents) {
    const downAt = {};
    for (const e of events.slice().sort((a, b) => a.t - b.t)) {
      if (e.type === 'down') downAt[e.code] = e.t;
      else if (e.type === 'up' && downAt[e.code] != null) {
        const d = e.t - downAt[e.code];
        if (d > 0 && d <= DWELL_CAP) samples.push(d);
        delete downAt[e.code];
      }
    }
  }
  if (samples.length < 20) return null;
  return { meanMs: Math.round(mean(samples)), stdMs: Math.round(std(samples)), perKeyReachMs: {} };
}

function deriveBigrams(allEvents) {
  const map = {};
  for (const events of allEvents) {
    const d = downs(events);
    for (let i = 1; i < d.length; i++) {
      const a = d[i - 1].key;
      const b = d[i].key;
      if (!/^[a-zA-Z]$/.test(a) || !/^[a-zA-Z]$/.test(b)) continue;
      const dt = d[i].t - d[i - 1].t;
      if (dt <= 0 || dt > IK_CAP) continue;
      const pair = (a + b).toLowerCase();
      (map[pair] ||= []).push(dt);
    }
  }
  const out = {};
  Object.entries(map)
    .filter(([, v]) => v.length >= 3)
    .sort((x, y) => y[1].length - x[1].length)
    .slice(0, 60)
    .forEach(([pair, v]) => { out[pair] = Math.round(median(v)); });
  return Object.keys(out).length ? out : null;
}

function deriveErrors(allEvents) {
  let printable = 0;
  const bsDowns = [];
  for (const events of allEvents) {
    const sorted = events.slice().sort((a, b) => a.t - b.t);
    for (const e of sorted) {
      if (isPrintable(e)) printable++;
      if (e.type === 'down' && e.key === 'Backspace') bsDowns.push(e);
    }
  }
  if (printable < 30) return null;

  // Group backspaces into runs (gap < 400ms).
  const runs = [];
  let cur = null;
  for (const e of bsDowns.sort((a, b) => a.t - b.t)) {
    if (cur && e.t - cur.last <= 400) {
      cur.count++;
      cur.ctrl = cur.ctrl || e.ctrlKey || e.altKey;
      cur.last = e.t;
    } else {
      cur = { count: 1, ctrl: e.ctrlKey || e.altKey, start: e.t, last: e.t };
      runs.push(cur);
    }
  }

  const styleCounts = { singleBackspace: 0, backspaceSpam: 0, ctrlBackspaceWord: 0, selectRetype: 0 };
  for (const r of runs) {
    if (r.ctrl) styleCounts.ctrlBackspaceWord++;
    else if (r.count === 1) styleCounts.singleBackspace++;
    else styleCounts.backspaceSpam++;
  }
  const totalRuns = runs.length || 1;
  const correctionStyle = {
    singleBackspace: +(styleCounts.singleBackspace / totalRuns).toFixed(2),
    backspaceSpam: +(styleCounts.backspaceSpam / totalRuns).toFixed(2),
    ctrlBackspaceWord: +(styleCounts.ctrlBackspaceWord / totalRuns).toFixed(2),
    selectRetype: 0,
  };

  return {
    ratePer100: +clamp((bsDowns.length / printable) * 100, 0, 25).toFixed(1),
    correctionStyle: runs.length >= 3 ? correctionStyle : DEFAULT_PROFILE.errors.correctionStyle,
    correctionDelayMs: DEFAULT_PROFILE.errors.correctionDelayMs,
    typoMix: DEFAULT_PROFILE.errors.typoMix, // can't be reliably measured from copy typing
  };
}

function deriveRhythm(composeEvents) {
  const d = downs(composeEvents);
  if (d.length < 20) return null;
  const burstWords = [];
  const burstGaps = [];
  let words = 0;
  let lastSpace = false;
  for (let i = 1; i < d.length; i++) {
    const dt = d[i].t - d[i - 1].t;
    const ch = d[i].key;
    if (dt > BURST_GAP) {
      if (words > 0) burstWords.push(words);
      if (dt <= 8000) burstGaps.push(dt);
      words = 0;
      lastSpace = false;
    }
    if (ch === ' ' && !lastSpace) { words++; lastSpace = true; }
    else if (ch !== ' ') lastSpace = false;
  }
  if (words > 0) burstWords.push(words);
  if (burstWords.length < 2) return null;
  return {
    burstLengthWords: { mean: +mean(burstWords).toFixed(1), std: +Math.max(0.5, std(burstWords)).toFixed(1) },
    interBurstPauseMs: burstGaps.length
      ? { mean: Math.round(mean(burstGaps)), std: Math.round(std(burstGaps)) }
      : DEFAULT_PROFILE.rhythm.interBurstPauseMs,
  };
}

function deriveCognitive(allEvents) {
  const base = { ...DEFAULT_PROFILE.cognitive };
  const afterSentence = [];
  const afterMid = [];
  const shiftExtra = [];
  let baseMean = 0;
  const allIk = allEvents.flatMap((ev) => intervals(ev, IK_CAP));
  if (allIk.length) baseMean = mean(allIk);

  for (const events of allEvents) {
    const d = downs(events);
    for (let i = 1; i < d.length; i++) {
      const prev = d[i - 1].key;
      const dt = d[i].t - d[i - 1].t;
      if (dt <= 0 || dt > 6000) continue;
      if (/[.!?]/.test(prev)) afterSentence.push(dt);
      else if (/[,;:]/.test(prev)) afterMid.push(dt);
      if (baseMean && d[i].shiftKey && dt < IK_CAP) shiftExtra.push(Math.max(0, dt - baseMean));
    }
  }
  if (afterSentence.length >= 3) base.sentenceEndPauseMs = Math.round(median(afterSentence));
  if (afterMid.length >= 3) base.midPunctuationPauseMs = Math.round(median(afterMid));
  if (shiftExtra.length >= 5) base.capShiftMs = clamp(Math.round(median(shiftExtra)), 10, 400);
  return base;
}

function deriveFatigue(copyEvents) {
  const iks = copyEvents.flatMap((ev) => intervals(ev, IK_CAP));
  const base = { ...DEFAULT_PROFILE.fatigue };
  if (iks.length < 60) return base;
  const third = Math.floor(iks.length / 3);
  const early = mean(iks.slice(0, third));
  const late = mean(iks.slice(-third));
  if (early > 0) {
    const ratio = late / early;
    const kchars = iks.length / 1000;
    const decay = (ratio - 1) / Math.max(0.05, kchars);
    base.decayRatePerKChar = +clamp(decay, 0, 0.5).toFixed(2);
  }
  return base;
}

/**
 * @param {Array<{id:string, compose:boolean, discard:boolean, events:Array}>} steps
 * @returns {object} a complete TypingProfile
 */
export function deriveProfile(steps) {
  const kept = steps.filter((s) => !s.discard);
  const allEvents = kept.map((s) => s.events);
  const copyEvents = kept.filter((s) => !s.compose).map((s) => s.events);
  const composeStep = kept.find((s) => s.compose);

  const profile = structuredClone(DEFAULT_PROFILE);
  profile.meta = {
    id: 'prf_' + Math.random().toString(36).slice(2, 10),
    createdAt: new Date().toISOString(),
    layout: 'qwerty-us',
    locale: (navigator.language || 'en-US'),
  };

  const speed = deriveSpeed(copyEvents.length ? copyEvents : allEvents);
  if (speed) profile.speed = speed;
  const dwell = deriveDwell(allEvents);
  if (dwell) profile.dwell = dwell;
  const bigrams = deriveBigrams(copyEvents.length ? copyEvents : allEvents);
  if (bigrams) profile.bigrams = bigrams;
  const errors = deriveErrors(allEvents);
  if (errors) profile.errors = errors;
  const rhythm = deriveRhythm(composeStep ? composeStep.events : allEvents.flat());
  if (rhythm) profile.rhythm = rhythm;
  profile.cognitive = deriveCognitive(allEvents);
  profile.fatigue = deriveFatigue(copyEvents.length ? copyEvents : allEvents);

  return profile;
}

/** A short, friendly personality label for the results screen. */
export function archetypeFor(profile) {
  const cs = profile.errors.correctionStyle;
  const wpm = profile.speed.baseWpm;
  const burst = profile.rhythm.burstLengthWords.mean;
  let style = 'The Steady Metronome';
  if ((cs.ctrlBackspaceWord || 0) >= 0.4) style = 'The Backspace Surgeon';
  else if ((cs.backspaceSpam || 0) >= 0.4) style = 'The Rapid Reviser';
  else if (burst >= 5 && wpm >= 70) style = 'The Burst Sprinter';
  else if (wpm < 45) style = 'The Thoughtful Tapper';
  return style;
}
