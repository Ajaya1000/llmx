import { describe, expect, it } from 'vitest';
import { DefaultVerifierDistiller } from '../src/verifier-distiller.ts';
import type { ContextPatch, Verdict } from '../src/wiki-types.ts';

const patch: ContextPatch = {
  contextId: 'tool-a',
  contextKind: 'tool',
  patch: 'fix the description',
};

function verdict(pass: boolean, reason?: string): Verdict {
  return { patch, pass, evidenceRefs: ['v1'], reason };
}

describe('DefaultVerifierDistiller', () => {
  it('maps a passing verdict to a strategy row keyed by context', () => {
    const [row] = new DefaultVerifierDistiller().distill([verdict(true)]);

    expect(row.kind).toBe('strategy');
    expect(row.polarity).toBe('positive');
    expect(row.culprit).toEqual({
      role: 'introducer',
      kind: 'tool',
      ref: 'tool-a',
    });
    expect(row.patch).toBe(patch);
  });

  it('maps a failing verdict to a failure row with the reason', () => {
    const [row] = new DefaultVerifierDistiller().distill([
      verdict(false, 'regression'),
    ]);

    expect(row.kind).toBe('failure');
    expect(row.polarity).toBe('negative');
    expect(row.content).toContain('regression');
  });
});
