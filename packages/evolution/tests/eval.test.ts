import { describe, expect, it } from 'vitest';
import {
  DefaultTestInstanceDeriver,
  type EvalCandidate,
  type FailingTrajectory,
  InMemoryContextEvalStore,
} from '../src/eval.ts';
import type { Ref } from '../src/types.ts';

const failing: FailingTrajectory = {
  input: 'compute 2+2',
  correction: '4',
};

function candidate(
  contextId: Ref,
  input = failing.input,
  expected?: string,
): EvalCandidate {
  return { contextId, input, expected, source: 'failure' };
}

describe('DefaultTestInstanceDeriver', () => {
  it('binds a failing input to each relevant context', () => {
    const evals = new DefaultTestInstanceDeriver().derive(failing, [
      'tool-a',
      'skill-b',
    ]);

    expect(evals).toHaveLength(2);
    expect(evals[0]).toEqual({
      contextId: 'tool-a',
      input: 'compute 2+2',
      expected: '4',
      source: 'failure',
    });
    expect(evals[1].contextId).toBe('skill-b');
  });
});

describe('InMemoryContextEvalStore', () => {
  it('persists a novel candidate and rejects a duplicate', () => {
    const store = new InMemoryContextEvalStore();

    const first = store.persist(candidate('tool-a'));
    expect(first?.contextId).toBe('tool-a');
    expect(store.evalsFor('tool-a')).toHaveLength(1);

    // identical candidate → not worth adding, not persisted
    expect(store.worthAdding('tool-a', candidate('tool-a'))).toBe(false);
    expect(store.persist(candidate('tool-a'))).toBeNull();
    expect(store.evalsFor('tool-a')).toHaveLength(1);

    // novel input for the same context → worth adding and persisted
    expect(
      store.worthAdding('tool-a', candidate('tool-a', 'different input')),
    ).toBe(true);
    expect(
      store.persist(candidate('tool-a', 'different input')),
    ).not.toBeNull();
    expect(store.evalsFor('tool-a')).toHaveLength(2);
  });

  it('keeps eval sets context-specific', () => {
    const store = new InMemoryContextEvalStore();
    store.persist(candidate('tool-a', 'x'));

    // same input, different context → still novel for that context
    expect(store.worthAdding('tool-b', candidate('tool-b', 'x'))).toBe(true);
    expect(store.evalsFor('tool-a')).toHaveLength(1);
    expect(store.evalsFor('tool-b')).toHaveLength(0);
  });
});
