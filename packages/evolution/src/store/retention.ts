import type { Ref } from '../types.ts';
import type { WikiRow } from '../wiki-types.ts';

export interface RetentionOptions {
  /** Evict only when unused for longer than this (ms). Default 30 days. */
  staleAfterMs?: number;
  /** Rows used fewer times than this are "cold". Default 2. */
  minUses?: number;
}

/**
 * Bounded, time-framed wiki reads for the Patch Proposer — never the executor.
 * Eviction keeps the store small; top-k keeps proposer input small.
 */
export interface RetentionPolicy {
  evict(rows: WikiRow[], now?: number): Ref[];
  topK(rows: WikiRow[], k: number, now?: number): WikiRow[];
}

const DAY = 24 * 60 * 60 * 1000;

export class DefaultRetentionPolicy implements RetentionPolicy {
  private readonly staleAfterMs: number;
  private readonly minUses: number;

  constructor(options: RetentionOptions = {}) {
    this.staleAfterMs = options.staleAfterMs ?? 30 * DAY;
    this.minUses = options.minUses ?? 2;
  }

  /** Evict only stale *and* cold rows: old-and-unused, never old-but-hot. */
  evict(rows: WikiRow[], now = Date.now()): Ref[] {
    const out: Ref[] = [];
    for (const row of rows) {
      const stale = now - row.lastUsedAt > this.staleAfterMs;
      const cold = row.useCount < this.minUses;
      if (stale && cold) out.push(row.id);
    }
    return out;
  }

  /** Top-k by recency × frequency × blame convergence. */
  topK(rows: WikiRow[], k: number, now = Date.now()): WikiRow[] {
    const convergence = new Map<Ref, number>();
    for (const row of rows) {
      const ref = row.culprit?.ref;
      if (ref) convergence.set(ref, (convergence.get(ref) ?? 0) + 1);
    }

    const score = (row: WikiRow): number => {
      const recency = 1 / (1 + (now - row.lastUsedAt) / (60 * 60 * 1000));
      const frequency = 1 + Math.log1p(row.useCount);
      const ref = row.culprit?.ref;
      const conv = ref ? 1 + Math.log1p(convergence.get(ref) ?? 0) : 1;
      return recency * frequency * conv;
    };

    return [...rows].sort((a, b) => score(b) - score(a)).slice(0, k);
  }
}
