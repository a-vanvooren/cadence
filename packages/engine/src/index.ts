/**
 * Cadence simulation engine — entry point.
 *
 * plan(text, profile, context) -> a timed Action[] that an injector replays.
 * Pure and deterministic given a seed. See docs/phase-2-simulation-engine.md.
 */
import type { Action, PauseReason, PlanContext, PlanResult, TypingProfile } from './types';
import {
  Rng,
  clamp,
  logNormalDelay,
  mulberry32,
  sampleNormal,
  wpmToInterKeyMs,
} from './humanize';
import {
  inferLoad,
  isQuoteBoundary,
  quotePauseMs,
  sentencePauseMs,
  wordComplexity,
} from './cognitive';
import {
  adjacentKey,
  chooseCorrectionStyle,
  chooseTypoType,
  currentErrorProbability,
  isTypoCandidate,
  TypoType,
} from './typos';

const MIN_DELAY = 20;
const MAX_DELAY = 8000;
const MAX_FATIGUE = 1.35;

/** Characters that require holding Shift on a QWERTY-US layout. */
function needsShift(ch: string): boolean {
  return /[A-Z]/.test(ch) || /[~!@#$%^&*()_+{}|:"<>?]/.test(ch);
}

export function plan(text: string, profile: TypingProfile, ctx: PlanContext = {}): PlanResult {
  const seed = ctx.seed ?? Math.floor(Math.random() * 2 ** 31);
  const rng: Rng = mulberry32(seed);
  const load = inferLoad(text, ctx);

  const actions: Action[] = [];
  const meanIK = profile.speed.meanInterKeyMs || wpmToInterKeyMs(profile.speed.baseWpm);
  const stdIK = profile.speed.stdInterKeyMs || meanIK * 0.3;
  const reachMap = profile.dwell?.perKeyReachMs ?? {};

  let cumChars = 0;
  let prev = ''; // last emitted character, for bigram timing
  let wordsInBurst = 0;
  let burstBudget = Math.max(1, Math.round(sampleNormal(rng, profile.rhythm.burstLengthWords, 1, 12)));

  const pushPause = (delayMs: number, reason: PauseReason) => {
    if (delayMs > 0) actions.push({ type: 'pause', delayMs, reason });
  };

  const fatigue = () => clamp(1 + profile.fatigue.decayRatePerKChar * (cumChars / 1000), 1, MAX_FATIGUE);

  /** Delay before typing `cur`, given the previously typed `prevChar`. */
  const charDelay = (prevChar: string, cur: string): number => {
    const pair = (prevChar + cur).toLowerCase();
    const base = profile.bigrams[pair] ?? meanIK;
    const sampled = logNormalDelay(rng, base * fatigue(), stdIK);
    const reach = reachMap[cur.toLowerCase()] ?? 0;
    const shift = needsShift(cur) ? profile.cognitive.capShiftMs : 0;
    return clamp(sampled + reach + shift, MIN_DELAY, MAX_DELAY);
  };

  const backspaceDelay = () => clamp(logNormalDelay(rng, meanIK * 0.6, stdIK), MIN_DELAY, MAX_DELAY);
  const noticeDelay = () => sampleNormal(rng, profile.errors.correctionDelayMs, 30, 4000);

  const emitKey = (ch: string, correction = false) => {
    actions.push({ type: 'key', char: ch, delayMs: charDelay(prev, ch), shift: needsShift(ch), correction });
    prev = ch;
    cumChars++;
  };

  const typeClean = (s: string) => {
    for (const ch of s) emitKey(ch);
  };

  /** First index in `word` that should be mistyped, or -1. At most one error per word. */
  const pickErrorIndex = (word: string): number => {
    const p = currentErrorProbability(profile, cumChars / 1000);
    for (let i = 0; i < word.length; i++) {
      if (isTypoCandidate(word[i]) && rng() < p) return i;
    }
    return -1;
  };

  /**
   * Emit the *wrong* keystrokes for an error at `word[i]`.
   * Returns the stray-char count to delete, the correct text to retype, and the
   * index in `word` to continue from.
   */
  const emitWrongUnit = (
    word: string,
    i: number,
    type: TypoType,
  ): { stray: number; correct: string; next: number } => {
    const canTranspose = i + 1 < word.length && isTypoCandidate(word[i + 1]);
    if (type === 'transposition' && canTranspose) {
      emitKey(word[i + 1], true);
      emitKey(word[i], true);
      return { stray: 2, correct: word[i] + word[i + 1], next: i + 2 };
    }
    if (type === 'doubleLetter') {
      emitKey(word[i]);
      emitKey(word[i], true); // accidental repeat
      return { stray: 1, correct: '', next: i + 1 }; // one copy is already correct
    }
    // adjacent (and droppedLetter, modeled conservatively as a neighbour slip)
    emitKey(adjacentKey(word[i]), true);
    return { stray: 1, correct: word[i], next: i + 1 };
  };

  const typeWord = (word: string) => {
    const errIdx = pickErrorIndex(word);
    if (errIdx < 0) {
      typeClean(word);
      return;
    }

    const style = chooseCorrectionStyle(profile, rng);
    const type = chooseTypoType(profile, rng);
    const wholeWordDelete = style === 'ctrlBackspaceWord' || style === 'selectRetype';

    if (wholeWordDelete) {
      // Type a wrong version of the whole word, notice, nuke it, retype clean.
      typeClean(word.slice(0, errIdx));
      const wrong = emitWrongUnit(word, errIdx, type);
      typeClean(word.slice(wrong.next)); // finish out the (now-wrong) word
      pushPause(noticeDelay(), 'correction-notice');
      actions.push({ type: 'deleteWord', delayMs: backspaceDelay() });
      prev = ' ';
      typeClean(word);
      return;
    }

    // Local backspace correction (single or spam).
    typeClean(word.slice(0, errIdx));
    const { stray, correct, next } = emitWrongUnit(word, errIdx, type);
    pushPause(noticeDelay(), 'correction-notice');

    let backspaces = stray;
    let retypePrefix = '';
    if (style === 'backspaceSpam') {
      const extra = Math.round(sampleNormal(rng, { mean: 1, std: 1 }, 0, 2));
      const start = Math.max(0, errIdx - extra);
      retypePrefix = word.slice(start, errIdx); // correct chars we over-deleted
      backspaces += retypePrefix.length;
    }
    for (let k = 0; k < backspaces; k++) {
      actions.push({ type: 'backspace', delayMs: backspaceDelay() });
    }
    typeClean(retypePrefix + correct);
    typeClean(word.slice(next));
  };

  // ---- Main lossless walk over the text -------------------------------------
  const tokens = text.match(/\s+|\S+/g) ?? [];
  let prevWord = '';

  for (const token of tokens) {
    const isWhitespace = /^\s+$/.test(token);
    if (isWhitespace) {
      typeClean(token);
      continue;
    }

    // Boundary pause based on how the previous word ended.
    if (isQuoteBoundary(token, load)) {
      pushPause(quotePauseMs(ctx, rng), 'pre-quote');
    } else if (/[.!?]["”']?$/.test(prevWord)) {
      pushPause(sentencePauseMs(load, rng), 'sentence-end');
    } else if (/[,;:]$/.test(prevWord)) {
      pushPause(profile.cognitive.midPunctuationPauseMs ?? 200, 'mid-punctuation');
    }

    // Burst (micro-chunk) accounting.
    if (wordsInBurst >= burstBudget) {
      pushPause(sampleNormal(rng, profile.rhythm.interBurstPauseMs, 40), 'inter-burst');
      wordsInBurst = 0;
      burstBudget = Math.max(1, Math.round(sampleNormal(rng, profile.rhythm.burstLengthWords, 1, 12)));
    }
    wordsInBurst++;

    // Lexical hesitation before complex/rare words.
    const cx = wordComplexity(token);
    if (cx > 0.2) pushPause(profile.cognitive.lexicalHesitationMs * cx * 2, 'lexical');

    typeWord(token);
    prevWord = token;
  }

  const estimatedMs = actions.reduce((s, a) => s + a.delayMs, 0);
  return { actions, estimatedMs, seedUsed: seed };
}

export * from './types';
export * from './humanize';
export * from './cognitive';
export * from './typos';
