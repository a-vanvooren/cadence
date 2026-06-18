/**
 * Spatial typo model. Produces realistic physical mistakes (adjacency
 * substitutions, transpositions, doubled/dropped letters) and decides how the
 * user corrects them, driven by the profile's error model.
 */
import type { TypingProfile } from './types';
import { Rng, weightedPick } from './humanize';

/** QWERTY-US physical neighbours (lowercase). Used for adjacency substitutions. */
const QWERTY_ADJACENCY: Record<string, string> = {
  q: 'wa', w: 'qeas', e: 'wrsd', r: 'etdf', t: 'rygf', y: 'tugh', u: 'yihj',
  i: 'uojk', o: 'ipkl', p: 'ol',
  a: 'qwsz', s: 'awedxz', d: 'serfcx', f: 'drtgvc', g: 'ftyhbv', h: 'gyujnb',
  j: 'huikmn', k: 'jiolm', l: 'kop',
  z: 'asx', x: 'zsdc', c: 'xdfv', v: 'cfgb', b: 'vghn', n: 'bhjm', m: 'njk',
};

export type TypoType = 'adjacent' | 'transposition' | 'doubleLetter' | 'droppedLetter';
export type CorrectionStyle = 'singleBackspace' | 'backspaceSpam' | 'ctrlBackspaceWord' | 'selectRetype';

/** A neighbouring key for `char`, preserving case. Falls back to the char itself. */
export function adjacentKey(char: string, rng: Rng): string {
  const lower = char.toLowerCase();
  const neighbours = QWERTY_ADJACENCY[lower];
  if (!neighbours) return char;
  const pick = neighbours[Math.floor(rng() * neighbours.length)];
  return char === lower ? pick : pick.toUpperCase();
}

export function chooseTypoType(profile: TypingProfile, rng: Rng): TypoType {
  return weightedPick<TypoType>(rng, {
    adjacent: profile.errors.typoMix.adjacent ?? 0.6,
    transposition: profile.errors.typoMix.transposition ?? 0.2,
    doubleLetter: profile.errors.typoMix.doubleLetter ?? 0.1,
    droppedLetter: profile.errors.typoMix.droppedLetter ?? 0.1,
  });
}

export function chooseCorrectionStyle(profile: TypingProfile, rng: Rng): CorrectionStyle {
  return weightedPick<CorrectionStyle>(rng, {
    singleBackspace: profile.errors.correctionStyle.singleBackspace ?? 0.5,
    backspaceSpam: profile.errors.correctionStyle.backspaceSpam ?? 0.15,
    ctrlBackspaceWord: profile.errors.correctionStyle.ctrlBackspaceWord ?? 0.3,
    selectRetype: profile.errors.correctionStyle.selectRetype ?? 0.05,
  });
}

/**
 * Probability that the user typos on the NEXT character, given fatigue progress.
 * `progressKChars` is cumulative characters typed / 1000.
 */
export function currentErrorProbability(profile: TypingProfile, progressKChars: number): number {
  const base = profile.errors.ratePer100 / 100;
  const grown = base * (1 + profile.fatigue.errorGrowthPerKChar * progressKChars);
  return Math.min(0.25, grown); // cap: nobody typos a quarter of the time
}

/** Only letters are good typo candidates; spaces/punctuation/digits are left clean-ish. */
export function isTypoCandidate(char: string): boolean {
  return /[a-zA-Z]/.test(char);
}
