/**
 * Randomness + timing primitives.
 *
 * Golden rule (see docs/phase-2-simulation-engine.md):
 *   every delay = base × contextual multipliers + Gaussian noise, clamped to
 *   plausible human bounds. All randomness flows through ONE seeded PRNG so a
 *   plan is reproducible.
 */

/** Deterministic, fast PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

/** Standard-normal sample via Box–Muller. */
export function gaussian(rng: Rng, mean = 0, std = 1): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + n * std;
}

/**
 * Log-normal-ish inter-key sample. Real inter-key intervals have a hard floor
 * (your fastest possible transition) and a long right tail (hesitations), so we
 * sample in log space around the mean rather than symmetrically.
 */
export function logNormalDelay(rng: Rng, meanMs: number, stdMs: number): number {
  const cv = Math.max(0.05, stdMs / Math.max(1, meanMs)); // coefficient of variation
  const sigma = Math.sqrt(Math.log(1 + cv * cv));
  const mu = Math.log(Math.max(1, meanMs)) - (sigma * sigma) / 2;
  return Math.exp(gaussian(rng, mu, sigma));
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Sample from a {mean,std} normal, clamped to be non-negative by default. */
export function sampleNormal(rng: Rng, n: { mean: number; std: number }, lo = 0, hi = Infinity): number {
  return clamp(gaussian(rng, n.mean, n.std), lo, hi);
}

/** Weighted pick from a record of label→weight. Tolerates missing/zero weights. */
export function weightedPick<T extends string>(rng: Rng, weights: Partial<Record<T, number>>): T {
  const entries = Object.entries(weights).filter(([, w]) => (w as number) > 0) as [T, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  if (total <= 0) return entries[0]?.[0] ?? (Object.keys(weights)[0] as T);
  let r = rng() * total;
  for (const [label, w] of entries) {
    r -= w;
    if (r <= 0) return label;
  }
  return entries[entries.length - 1][0];
}

/** base inter-key interval (ms) from words-per-minute (5 chars/word convention). */
export function wpmToInterKeyMs(wpm: number): number {
  return 60000 / (Math.max(1, wpm) * 5);
}
