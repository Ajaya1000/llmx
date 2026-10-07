import { describe, expect, it } from 'vitest';
import { DefaultGate } from '../src/gate.ts';
import type { ContextPatch, Verdict } from '../src/wiki-types.ts';

const patch: ContextPatch = {
  contextId: 'tool-a',
  contextKind: 'tool',
  patch: 'fix',
};
const passed: Verdict = { patch, pass: true, evidenceRefs: ['v1'] };
const failed: Verdict = { patch, pass: false, evidenceRefs: ['v1'] };

describe('DefaultGate', () => {
  it('delegates a passing verdict to the human decision', () => {
    const gate = new DefaultGate(() => 'approved');
    expect(gate.review(passed)).toBe('approved');
  });

  it('never reaches the human decision for a failing verdict', () => {
    let called = false;
    const gate = new DefaultGate(() => {
      called = true;
      return 'approved';
    });

    expect(gate.review(failed)).toBe('rejected');
    expect(called).toBe(false);
  });

  it('rejects by default when no human decision is wired', () => {
    expect(new DefaultGate().review(passed)).toBe('rejected');
  });
});
