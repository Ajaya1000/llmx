import type { ContextPatch, Verdict } from '../wiki-types.ts';

/** A patch that passed validation and was approved — retained for audit/replay. */
export interface ApprovedPatch {
  patch: ContextPatch;
  verdict: Verdict;
  approvedAt: number;
}

/** Retention of approved patches (post-gate), kept for later audit/replay. */
export interface ApprovedPatchStore {
  retain(patch: ContextPatch, verdict: Verdict): void;
  list(): ApprovedPatch[];
}

export class InMemoryApprovedPatchStore implements ApprovedPatchStore {
  private retained: ApprovedPatch[] = [];

  retain(patch: ContextPatch, verdict: Verdict): void {
    this.retained.push({ patch, verdict, approvedAt: Date.now() });
  }

  list(): ApprovedPatch[] {
    return [...this.retained];
  }
}
