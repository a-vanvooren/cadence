// Cadence simulation engine — plain-JS port for the no-build extension MVP.
// Faithful to packages/engine/src/*. Exports plan(text, profile, ctx) -> { actions, estimatedMs, seedUsed }.

const MIN_DELAY = 20;
const MAX_DELAY = 8000;
const MAX_FATIGUE = 1.35;

// ---- randomness / timing ----------------------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng, mean = 0, std = 1) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + n * std;
}

function logNormalDelay(rng, meanMs, stdMs) {
  const cv = Math.max(0.05, stdMs / Math.max(1, meanMs));
  const sigma = Math.sqrt(Math.log(1 + cv * cv));
  const mu = Math.log(Math.max(1, meanMs)) - (sigma * sigma) / 2;
  return Math.exp(gaussian(rng, mu, sigma));
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function sampleNormal(rng, n, lo = 0, hi = Infinity) {
  return clamp(gaussian(rng, n.mean, n.std), lo, hi);
}

function weightedPick(rng, weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  if (total <= 0) return entries[0] ? entries[0][0] : Object.keys(weights)[0];
  let r = rng() * total;
  for (const [label, w] of entries) {
    r -= w;
    if (r <= 0) return label;
  }
  return entries[entries.length - 1][0];
}

function wpmToInterKeyMs(wpm) {
  return 60000 / (Math.max(1, wpm) * 5);
}

// ---- spatial typos ----------------------------------------------------------
const QWERTY_ADJACENCY = {
  q: 'wa', w: 'qeas', e: 'wrsd', r: 'etdf', t: 'rygf', y: 'tugh', u: 'yihj',
  i: 'uojk', o: 'ipkl', p: 'ol',
  a: 'qwsz', s: 'awedxz', d: 'serfcx', f: 'drtgvc', g: 'ftyhbv', h: 'gyujnb',
  j: 'huikmn', k: 'jiolm', l: 'kop',
  z: 'asx', x: 'zsdc', c: 'xdfv', v: 'cfgb', b: 'vghn', n: 'bhjm', m: 'njk',
};

function adjacentKey(char, rng) {
  const lower = char.toLowerCase();
  const neighbours = QWERTY_ADJACENCY[lower];
  if (!neighbours) return char;
  const pick = neighbours[Math.floor(rng() * neighbours.length)];
  return char === lower ? pick : pick.toUpperCase();
}

function chooseTypoType(profile, rng) {
  const m = profile.errors.typoMix;
  return weightedPick(rng, {
    adjacent: m.adjacent ?? 0.6,
    transposition: m.transposition ?? 0.2,
    doubleLetter: m.doubleLetter ?? 0.1,
    droppedLetter: m.droppedLetter ?? 0.1,
  });
}

function chooseCorrectionStyle(profile, rng) {
  const c = profile.errors.correctionStyle;
  return weightedPick(rng, {
    singleBackspace: c.singleBackspace ?? 0.5,
    backspaceSpam: c.backspaceSpam ?? 0.15,
    ctrlBackspaceWord: c.ctrlBackspaceWord ?? 0.3,
    selectRetype: c.selectRetype ?? 0.05,
  });
}

function currentErrorProbability(profile, progressKChars) {
  const base = profile.errors.ratePer100 / 100;
  const grown = base * (1 + profile.fatigue.errorGrowthPerKChar * progressKChars);
  return Math.min(0.25, grown);
}

function isTypoCandidate(char) {
  return /[a-zA-Z]/.test(char);
}

// ---- cognitive pacing -------------------------------------------------------
const COMMON_WORDS = new Set(
  ('the be to of and a in that have i it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us is are was were been has had did said get got').split(' ')
);

function wordComplexity(word) {
  const w = word.trim();
  if (!w) return 0;
  const lower = w.toLowerCase().replace(/[^a-z]/g, '');
  if (lower && COMMON_WORDS.has(lower)) return 0.05;
  const lengthScore = Math.min(1, Math.max(0, (w.length - 4) / 12));
  const nonAlpha = (w.match(/[^a-zA-Z]/g) || []).length / w.length;
  const rarity = lower && lower.length > 6 ? 0.4 : 0.15;
  return Math.min(1, 0.5 * lengthScore + 0.3 * nonAlpha + 0.2 * rarity);
}

function inferLoad(text, ctx) {
  if (ctx.load) return ctx.load;
  const hint = (ctx.targetHint || '').toLowerCase();
  if (/(chat|message|slack|whatsapp|sms|dm|comment|tweet|x\.com)/.test(hint)) return 'light';
  if (/(docs|paper|essay|thesis|notion|word|overleaf|research|report)/.test(hint)) return 'heavy';
  const hasCitations = /\([A-Z][a-z]+,?\s*\d{4}\)/.test(text) || /https?:\/\//.test(text) || /["“][^"”]{40,}["”]/.test(text);
  const longForm = text.length > 600;
  if (hasCitations || longForm) return 'heavy';
  if (text.length < 160) return 'light';
  return 'medium';
}

const LOAD_PRESEG = {
  light: { mean: 40, jitter: 60 },
  medium: { mean: 320, jitter: 260 },
  heavy: { mean: 900, jitter: 700 },
};

function sentencePauseMs(load, sample) {
  const p = LOAD_PRESEG[load];
  return Math.max(0, p.mean + (sample() - 0.5) * 2 * p.jitter);
}

function looksLikeQuote(s) {
  return /^[\s>]*["“]/.test(s) || /\([A-Z][a-z]+,?\s*\d{4}\)/.test(s) || /https?:\/\//.test(s);
}

function isQuoteBoundary(token, load) {
  return load === 'heavy' && looksLikeQuote(token);
}

function quotePauseMs(ctx, sample) {
  const [lo, hi] = ctx.quotePauseMsRange ?? [5000, 15000];
  return lo + sample() * (hi - lo);
}

function needsShift(ch) {
  return /[A-Z]/.test(ch) || /[~!@#$%^&*()_+{}|:"<>?]/.test(ch);
}

// ---- main pipeline ----------------------------------------------------------
export function plan(text, profile, ctx = {}) {
  text = String(text).replace(/\r\n?/g, '\n'); // normalize newlines
  const seed = ctx.seed ?? Math.floor(Math.random() * 2 ** 31);
  const rng = mulberry32(seed);
  const load = inferLoad(text, ctx);

  const actions = [];
  const meanIK = profile.speed.meanInterKeyMs || wpmToInterKeyMs(profile.speed.baseWpm);
  const stdIK = profile.speed.stdInterKeyMs || meanIK * 0.3;
  const reachMap = (profile.dwell && profile.dwell.perKeyReachMs) || {};

  let cumChars = 0;
  let prev = '';
  let wordsInBurst = 0;
  let burstBudget = Math.max(1, Math.round(sampleNormal(rng, profile.rhythm.burstLengthWords, 1, 12)));

  const pushPause = (delayMs, reason) => {
    if (delayMs > 0) actions.push({ type: 'pause', delayMs, reason });
  };

  const fatigue = () => clamp(1 + profile.fatigue.decayRatePerKChar * (cumChars / 1000), 1, MAX_FATIGUE);

  const charDelay = (prevChar, cur) => {
    const pair = (prevChar + cur).toLowerCase();
    const base = profile.bigrams[pair] ?? meanIK;
    const sampled = logNormalDelay(rng, base * fatigue(), stdIK);
    const reach = reachMap[cur.toLowerCase()] ?? 0;
    const shift = needsShift(cur) ? profile.cognitive.capShiftMs : 0;
    return clamp(sampled + reach + shift, MIN_DELAY, MAX_DELAY);
  };

  const backspaceDelay = () => clamp(logNormalDelay(rng, meanIK * 0.6, stdIK), MIN_DELAY, MAX_DELAY);
  const noticeDelay = () => sampleNormal(rng, profile.errors.correctionDelayMs, 30, 4000);

  const emitKey = (ch, correction = false) => {
    actions.push({ type: 'key', char: ch, delayMs: charDelay(prev, ch), shift: needsShift(ch), correction });
    prev = ch;
    cumChars++;
  };

  const typeClean = (s) => {
    for (const ch of s) emitKey(ch);
  };

  const pickErrorIndex = (word) => {
    const p = currentErrorProbability(profile, cumChars / 1000);
    for (let i = 0; i < word.length; i++) {
      if (isTypoCandidate(word[i]) && rng() < p) return i;
    }
    return -1;
  };

  const emitWrongUnit = (word, i, type) => {
    const canTranspose = i + 1 < word.length && isTypoCandidate(word[i + 1]);
    if (type === 'transposition' && canTranspose) {
      emitKey(word[i + 1], true);
      emitKey(word[i], true);
      return { stray: 2, correct: word[i] + word[i + 1], next: i + 2 };
    }
    if (type === 'doubleLetter') {
      emitKey(word[i]);
      emitKey(word[i], true);
      return { stray: 1, correct: '', next: i + 1 };
    }
    emitKey(adjacentKey(word[i], rng), true);
    return { stray: 1, correct: word[i], next: i + 1 };
  };

  const typeWord = (word) => {
    const errIdx = pickErrorIndex(word);
    if (errIdx < 0) {
      typeClean(word);
      return;
    }

    const style = chooseCorrectionStyle(profile, rng);
    const type = chooseTypoType(profile, rng);
    const wholeWordDelete = style === 'ctrlBackspaceWord' || style === 'selectRetype';

    if (wholeWordDelete) {
      typeClean(word.slice(0, errIdx));
      const wrong = emitWrongUnit(word, errIdx, type);
      typeClean(word.slice(wrong.next));
      pushPause(noticeDelay(), 'correction-notice');
      actions.push({ type: 'deleteWord', delayMs: backspaceDelay() });
      prev = ' ';
      typeClean(word);
      return;
    }

    typeClean(word.slice(0, errIdx));
    const { stray, correct, next } = emitWrongUnit(word, errIdx, type);
    pushPause(noticeDelay(), 'correction-notice');

    let backspaces = stray;
    let retypePrefix = '';
    if (style === 'backspaceSpam') {
      const extra = Math.round(sampleNormal(rng, { mean: 1, std: 1 }, 0, 2));
      const start = Math.max(0, errIdx - extra);
      retypePrefix = word.slice(start, errIdx);
      backspaces += retypePrefix.length;
    }
    for (let k = 0; k < backspaces; k++) {
      actions.push({ type: 'backspace', delayMs: backspaceDelay() });
    }
    typeClean(retypePrefix + correct);
    typeClean(word.slice(next));
  };

  const tokens = text.match(/\s+|\S+/g) ?? [];
  let prevWord = '';

  for (const token of tokens) {
    if (/^\s+$/.test(token)) {
      typeClean(token);
      continue;
    }

    if (isQuoteBoundary(token, load)) {
      pushPause(quotePauseMs(ctx, rng), 'pre-quote');
    } else if (/[.!?]["”']?$/.test(prevWord)) {
      pushPause(sentencePauseMs(load, rng), 'sentence-end');
    } else if (/[,;:]$/.test(prevWord)) {
      pushPause(profile.cognitive.midPunctuationPauseMs ?? 200, 'mid-punctuation');
    }

    if (wordsInBurst >= burstBudget) {
      pushPause(sampleNormal(rng, profile.rhythm.interBurstPauseMs, 40), 'inter-burst');
      wordsInBurst = 0;
      burstBudget = Math.max(1, Math.round(sampleNormal(rng, profile.rhythm.burstLengthWords, 1, 12)));
    }
    wordsInBurst++;

    const cx = wordComplexity(token);
    if (cx > 0.2) pushPause(profile.cognitive.lexicalHesitationMs * cx * 2, 'lexical');

    typeWord(token);
    prevWord = token;
  }

  const estimatedMs = actions.reduce((s, a) => s + a.delayMs, 0);
  return { actions, estimatedMs, seedUsed: seed };
}
