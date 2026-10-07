import { describe, expect, it } from 'vitest';
import type { Context } from '../src/types.ts';
import {
  DEFAULT_MAX_RETRIES,
  DefaultVerifier,
  type RunRunner,
} from '../src/verifier.ts';
import type { ContextPatch } from '../src/wiki-types.ts';

function ctx(id: string): Context {
  return { id, kind: 'tool', content: '', dependsOn: [] };
}

const original = [ctx('tool-a')];
const patched = [ctx('tool-a')];
const patch: ContextPatch = {
  contextId: 'tool-a',
  contextKind: 'tool',
  patch: 'fix the tool description',
};

function runner(results: boolean[]): RunRunner {
  let i = 0;
  return {
    run: () => ({ pass: results[i++ % results.length], evidenceRefs: ['v1'] }),
  };
}

describe('DefaultVerifier', () => {
  it('returns a pass verdict with evidence', () => {
    const verifier = new DefaultVerifier(runner([true]));

    expect(verifier.maxRetries).toBe(DEFAULT_MAX_RETRIES);
    const verdict = verifier.verify(original, patched, patch);
    expect(verdict.pass).toBe(true);
    expect(verdict.patch).toBe(patch);
    expect(verdict.evidenceRefs).toEqual(['v1']);
  });

  it('returns a fail verdict and carries the configured retry bound', () => {
    const verifier = new DefaultVerifier(runner([false]), 5);

    const verdict = verifier.verify(original, patched, patch);
    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toBeUndefined();
    expect(verifier.maxRetries).toBe(5);
  });
});
