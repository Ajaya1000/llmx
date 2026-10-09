import type { ContextPatch, Verdict, WikiRow } from './wiki-types.ts';

/**
 * Turns validation verdicts into wiki rows: a passing patch becomes a
 * `strategy` row, a failing one a `failure` row — both keyed to the patch's
 * context. Input to the wiki (via `WikiPort.record`), like the trajectory
 * distiller.
 */
export interface VerifierDistiller {
  distill(verdicts: Verdict[]): WikiRow[];
}

export class DefaultVerifierDistiller implements VerifierDistiller {
  distill(verdicts: Verdict[]): WikiRow[] {
    const now = Date.now();
    return verdicts.map((verdict, i) => this.toRow(verdict, i, now));
  }

  private toRow(verdict: Verdict, i: number, now: number): WikiRow {
    const patch: ContextPatch = verdict.patch;
    const pass = verdict.pass;
    return {
      id: `verdict:${patch.contextId}:${i}`,
      // ponytail: verdict rows link to their validation run once the runner reports one.
      runId: '',
      kind: pass ? 'strategy' : 'failure',
      polarity: pass ? 'positive' : 'negative',
      author: { kind: 'agent', agentId: 'validator' },
      refs: {},
      culprit: {
        role: 'introducer',
        kind: patch.contextKind,
        ref: patch.contextId,
      },
      content: pass
        ? 'patch passed validation'
        : `patch failed validation${verdict.reason ? `: ${verdict.reason}` : ''}`,
      patch,
      useCount: 0,
      lastUsedAt: now,
      createdAt: now,
    };
  }
}
