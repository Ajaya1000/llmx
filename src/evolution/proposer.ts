import type { ContextRegistry } from './store/context-registry.ts';
import type { Ref } from './types.ts';
import type { ContextPatch, WikiRow } from './wiki-types.ts';

/**
 * Patch proposer. Maps prioritized failures to candidate patches: a failure's
 * culprit context becomes a ContextPatch; its transitive dependents become the
 * affected (re-validate) set.
 */
export interface PatchProposer {
  propose(failures: WikiRow[]): ContextPatch[];
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
}
