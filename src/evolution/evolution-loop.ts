import type { WikiPort } from './ports.ts';
import type { PatchProposer } from './proposer.ts';
import type { ContextRegistry } from './store/context-registry.ts';
import type { Context } from './types.ts';
import type { Verifier } from './verifier.ts';
import type { ContextPatch, Verdict } from './wiki-types.ts';

/** Applies a proposed patch to one context to get its patched form (never in place). */
export type PatchApplier = (context: Context, patch: ContextPatch) => Context;

/** Naive text merge — real patch semantics belong to the runtime adapter. */
export const appendPatch: PatchApplier = (context, patch) => ({
  ...context,
  content: context.content ? `${context.content}\n${patch.patch}` : patch.patch,
});

/** One propose → validate → bounded-retry pass over the wiki's failures. */
export interface EvolutionLoop {
  run(): EvolutionLoopResult;
}

export interface EvolutionLoopResult {
  /** Final verdict per proposed patch (after bounded retries). */
  verdicts: Verdict[];
  /** Retry attempts consumed across all patches. */
  retriesUsed: number;
}

/**
 * Ties the proposer and verifier together: reads prioritized failures, proposes
 * patches, validates each on a forked branch, and feeds a failed verdict back to
 * the proposer for up to `verifier.maxRetries` revisions.
 */
export class DefaultEvolutionLoop implements EvolutionLoop {
  constructor(
    private readonly wiki: WikiPort,
    private readonly proposer: PatchProposer,
    private readonly verifier: Verifier,
    private readonly registry: ContextRegistry,
    private readonly applier: PatchApplier = appendPatch,
  ) {}

  run(): EvolutionLoopResult {
    const failures = this.wiki.prioritizedFailures();
    const verdicts: Verdict[] = [];
    let retriesUsed = 0;

    for (const patch of this.proposer.propose(failures)) {
      let current = patch;
      let verdict = this.validate(current);
      while (!verdict.pass && retriesUsed < this.verifier.maxRetries) {
        const revision = this.proposer.revise(current, verdict);
        if (!revision) break;
        retriesUsed += 1;
        current = revision;
        verdict = this.validate(current);
      }
      verdicts.push(verdict);
    }

    return { verdicts, retriesUsed };
  }

  private validate(patch: ContextPatch): Verdict {
    const context = this.registry.get(patch.contextId);
    const original = context ? [context] : [];
    const patched = context ? [this.applier(context, patch)] : [];
    return this.verifier.verify(original, patched, patch);
  }
}
