import type { ContextRegistry } from './store/context-registry.ts';
import type { Ref } from './types.ts';
import type { ContextPatch, Verdict, WikiRow } from './wiki-types.ts';

/**
 * Patch proposer. Maps prioritized failures to candidate patches: a failure's
 * culprit context becomes a ContextPatch; its transitive dependents become the
 * affected (re-validate) set.
 */
export interface PatchProposer {
  propose(failures: WikiRow[]): ContextPatch[];
  /** Revise a patch after a failed verdict; null = give up this retry. */
  revise(patch: ContextPatch, verdict: Verdict): ContextPatch | null;
}

export class DefaultPatchProposer implements PatchProposer {
  constructor(private readonly registry: ContextRegistry) {}

  propose(failures: WikiRow[]): ContextPatch[] {
    const patches: ContextPatch[] = [];
    const seen = new Set<Ref>();
    for (const failure of failures) {
      const culprit = failure.culprit;
      if (!culprit?.ref || seen.has(culprit.ref)) continue;
      seen.add(culprit.ref);
      patches.push({
        contextId: culprit.ref,
        contextKind: culprit.kind,
        // ponytail: patch text comes from a model seam in a later step.
        patch: '',
        affected: this.registry.dependents(culprit.ref),
      });
    }
    return patches;
  }

  revise(_patch: ContextPatch, _verdict: Verdict): ContextPatch | null {
    // ponytail: auto-revision needs a model seam; the loop just gives up.
    return null;
  }
}
