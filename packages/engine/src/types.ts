/**
 * Core types for the Cadence simulation engine.
 *
 * The engine is pure and DOM-free: it turns (profile, text, context) into a
 * timed `Action[]` plan that an injector (Phase 3) replays. See ../README.md.
 */

export interface Normal {
  mean: number;
  std: number;
}

/** Mirrors schema/typing-profile.schema.json. */
export interface TypingProfile {
  version: string;
  meta: {
    id: string;
    createdAt: string;
    owner?: string;
    layout: string;
    locale?: string;
    signature?: string;
  };
  speed: {
    baseWpm: number;
    meanInterKeyMs: number;
    stdInterKeyMs: number;
  };
  bigrams: Record<string, number>;
  trigrams?: Record<string, number>;
  dwell?: {
    meanMs: number;
    stdMs: number;
    perKeyReachMs?: Record<string, number>;
  };
  errors: {
    ratePer100: number;
    correctionStyle: {
      singleBackspace?: number;
      backspaceSpam?: number;
      ctrlBackspaceWord?: number;
      selectRetype?: number;
    };
    correctionDelayMs: Normal & {
      noticeScope?: 'next-key' | 'end-of-word' | 'end-of-clause';
    };
    typoMix: {
      adjacent?: number;
      transposition?: number;
      doubleLetter?: number;
      droppedLetter?: number;
    };
  };
  rhythm: {
    burstLengthWords: Normal;
    interBurstPauseMs: Normal;
  };
  cognitive: {
    lexicalHesitationMs: number;
    sentenceEndPauseMs: number;
    midPunctuationPauseMs?: number;
    capShiftMs: number;
    shiftHandBias?: 'left' | 'right' | 'balanced';
  };
  fatigue: {
    decayRatePerKChar: number;
    errorGrowthPerKChar: number;
    recoveryOnPause?: number;
  };
}

export type CognitiveLoad = 'light' | 'medium' | 'heavy';

export interface PlanContext {
  /** Explicit override; otherwise inferred from `targetHint`/content. */
  load?: CognitiveLoad;
  /** Free-text hint about the destination, e.g. "Google Docs", a host, a field role. */
  targetHint?: string;
  /** Seed for reproducible plans (re-rolls). */
  seed?: number;
  /** Long pre-block pause range (ms) for quotes/citations under heavy load. */
  quotePauseMsRange?: [number, number];
}

/** A single replayable action. Each carries the delay to wait BEFORE performing it. */
export type Action =
  | { type: 'key'; char: string; delayMs: number; shift?: boolean; correction?: boolean }
  | { type: 'backspace'; delayMs: number }
  | { type: 'deleteWord'; delayMs: number } // Ctrl/Option+Backspace
  | { type: 'pause'; delayMs: number; reason: PauseReason };

export type PauseReason =
  | 'inter-burst'
  | 'lexical'
  | 'sentence-end'
  | 'mid-punctuation'
  | 'pre-quote'
  | 'post-quote'
  | 'correction-notice'
  | 'pre-paragraph';

export interface PlanResult {
  actions: Action[];
  /** Estimated wall-clock duration in ms (sum of all delays). */
  estimatedMs: number;
  seedUsed: number;
}
