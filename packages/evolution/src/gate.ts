import type { Verdict } from './wiki-types.ts';

export type GateDecision = 'approved' | 'rejected';

/**
 * Human approval seam. The loop only forwards *passed* verdicts here; a failed
 * verdict is rejected without ever reaching the human decision.
 */
export interface Gate {
  review(verdict: Verdict): GateDecision;
}

export class DefaultGate implements Gate {
  constructor(
    private readonly decide: (verdict: Verdict) => GateDecision = () =>
      'rejected',
  ) {}

  review(verdict: Verdict): GateDecision {
    // Failed verdicts never reach the human — a caller bug, not a decision.
    if (!verdict.pass) return 'rejected';
    return this.decide(verdict);
  }
}
