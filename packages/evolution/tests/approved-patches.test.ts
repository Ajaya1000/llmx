import { describe, expect, it } from 'vitest';
import { InMemoryApprovedPatchStore } from '../src/store/approved-patches.ts';
import type { ContextPatch, Verdict } from '../src/wiki-types.ts';

const patch: ContextPatch = {
  contextId: 'tool-a',
  contextKind: 'tool',
  patch: 'fix',
};
const verdict: Verdict = { patch, pass: true, evidenceRefs: ['v1'] };

describe('InMemoryApprovedPatchStore', () => {
  it('retains an approved patch and lists it back', () => {
    const store = new InMemoryApprovedPatchStore();
    store.retain(patch, verdict);

    const list = store.list();
    expect(list).toHaveLength(1);
    expect(list[0].patch).toBe(patch);
    expect(list[0].verdict).toBe(verdict);
    expect(list[0].approvedAt).toBeTypeOf('number');
  });
});
