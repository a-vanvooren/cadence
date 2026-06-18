/**
 * Context-aware cognitive pacing: infer load, score lexical complexity, find
 * sentence and quote/citation boundaries, and provide the timing multipliers
 * those drive. See docs/phase-2-simulation-engine.md §2.2, §2.6, §2.7.
 */
import type { CognitiveLoad, PlanContext } from './types';

/**
 * A tiny stand-in for an on-device frequency list. In production this is a
 * compact top-~5–10k English set; common words get ~zero hesitation, the rest
 * scale up. Kept small here so the package stays dependency-free.
 */
const COMMON_WORDS = new Set(
  ('the be to of and a in that have i it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us is are was were been has had did said get got').split(' ')
);

/** 0 (trivial) → 1 (very complex) complexity score for a single word/token. */
export function wordComplexity(word: string): number {
  const w = word.trim();
  if (!w) return 0;
  const lower = w.toLowerCase().replace(/[^a-z]/g, '');
  if (lower && COMMON_WORDS.has(lower)) return 0.05;

  const lengthScore = Math.min(1, Math.max(0, (w.length - 4) / 12)); // 4 chars ~easy, 16+ ~hard
  const nonAlpha = (w.match(/[^a-zA-Z]/g) || []).length / w.length; // symbols/digits/urls are costly
  const rarity = lower && lower.length > 6 ? 0.4 : 0.15; // crude rarity proxy when not in common set
  return Math.min(1, 0.5 * lengthScore + 0.3 * nonAlpha + 0.2 * rarity);
}

/** Infer cognitive load from an explicit override, the target hint, and the text. */
export function inferLoad(text: string, ctx: PlanContext): CognitiveLoad {
  if (ctx.load) return ctx.load;

  const hint = (ctx.targetHint || '').toLowerCase();
  if (/(chat|message|slack|whatsapp|sms|dm|comment|tweet|x\.com)/.test(hint)) return 'light';
  if (/(docs|paper|essay|thesis|notion|word|overleaf|research|report)/.test(hint)) return 'heavy';

  // Fall back to content shape.
  const hasCitations = /\([A-Z][a-z]+,?\s*\d{4}\)/.test(text) || /https?:\/\//.test(text) || /["“][^"”]{40,}["”]/.test(text);
  const longForm = text.length > 600;
  if (hasCitations || longForm) return 'heavy';
  if (text.length < 160) return 'light';
  return 'medium';
}

/** Heuristic: does this sentence read like a quotation/citation/pasted block? */
function looksLikeQuote(s: string): boolean {
  return /^[\s>]*["“]/.test(s) || /\([A-Z][a-z]+,?\s*\d{4}\)/.test(s) || /https?:\/\//.test(s);
}

/** Mean + symmetric jitter (ms) of the "thinking" pause at a sentence boundary, per load. */
const LOAD_PRESEG: Record<CognitiveLoad, { mean: number; jitter: number }> = {
  light: { mean: 40, jitter: 60 },
  medium: { mean: 320, jitter: 260 },
  heavy: { mean: 900, jitter: 700 },
};

/** Pause to emit at a sentence boundary, scaled by load. `sample` ∈ [0,1). */
export function sentencePauseMs(load: CognitiveLoad, sample: () => number): number {
  const p = LOAD_PRESEG[load];
  return Math.max(0, p.mean + (sample() - 0.5) * 2 * p.jitter);
}

/** Whether to apply the heavy "find the source" pause for this token + load. */
export function isQuoteBoundary(token: string, load: CognitiveLoad): boolean {
  return load === 'heavy' && looksLikeQuote(token);
}

/** Long "find and switch to the source" pause before a quote/citation. `sample` ∈ [0,1). */
export function quotePauseMs(ctx: PlanContext, sample: () => number): number {
  const [lo, hi] = ctx.quotePauseMsRange ?? [5000, 15000];
  return lo + sample() * (hi - lo);
}

export { looksLikeQuote };
