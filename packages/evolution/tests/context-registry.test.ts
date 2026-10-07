import { describe, expect, it } from 'vitest';
import { InMemoryContextRegistry } from '../src/store/context-registry.ts';
import type { Context } from '../src/types.ts';

function ctx(id: string, dependsOn: string[] = []): Context {
  return { id, kind: 'skill', content: '', dependsOn };
}

describe('InMemoryContextRegistry', () => {
  it('computes transitive dependents', () => {
    const r = new InMemoryContextRegistry();
    r.register(ctx('A', ['B']));
    r.register(ctx('B', ['C']));
    r.register(ctx('C'));

    expect(r.dependents('B').sort()).toEqual(['A']);
    expect(r.dependents('C').sort()).toEqual(['A', 'B']);
    expect(r.dependents('A')).toEqual([]);
  });

  it('merges static dependsOn with observed runtime usage edges', () => {
    const r = new InMemoryContextRegistry();
    r.register(ctx('skill-a'));
    r.register(ctx('tool-b'));
    r.observe([{ from: 'skill-a', to: 'tool-b' }]);

    expect(r.dependents('tool-b')).toEqual(['skill-a']);
  });

  it('subgraph returns the connected component, not disjoint contexts', () => {
    const r = new InMemoryContextRegistry();
    r.register(ctx('A', ['B']));
    r.register(ctx('B', ['C']));
    r.register(ctx('C'));
    r.register(ctx('D'));

    const ids = r
      .subgraph(['B'])
      .map((c) => c.id)
      .sort();
    expect(ids).toEqual(['A', 'B', 'C']);
  });
});
