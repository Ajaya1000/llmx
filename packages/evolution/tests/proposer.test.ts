import { describe, expect, it } from 'vitest';
import { DefaultPatchProposer } from '../src/proposer.ts';
import { InMemoryContextRegistry } from '../src/store/context-registry.ts';
import type { Context, ContextKind } from '../src/types.ts';
import type { Culprit, WikiRow } from '../src/wiki-types.ts';

function ctx(id: string, kind: ContextKind, dependsOn: string[] = []): Context {
  return { id, kind, content: '', dependsOn };
}

function failure(culprit: Culprit): WikiRow {
  return {
    id: 'f1',
    missionId: 'm1',
    kind: 'failure',
    polarity: 'negative',
    author: { kind: 'task', taskId: 't1' },
    refs: {},
    culprit,
    content: 'tool-x is wrong',
    useCount: 0,
    lastUsedAt: 0,
    createdAt: 0,
  };
}

describe('DefaultPatchProposer', () => {
  it('turns a tool culprit into a ContextPatch with its dependent list', () => {
    const registry = new InMemoryContextRegistry();
    registry.register(ctx('tool-x', 'tool'));
    registry.register(ctx('skill-a', 'skill', ['tool-x']));

    const patches = new DefaultPatchProposer(registry).propose([
      failure({ role: 'introducer', kind: 'tool', ref: 'tool-x' }),
    ]);

    expect(patches).toHaveLength(1);
    expect(patches[0].contextKind).toBe('tool');
    expect(patches[0].contextId).toBe('tool-x');
    expect(patches[0].affected).toEqual(['skill-a']);
  });

  it('dedups patches for the same culprit context', () => {
    const registry = new InMemoryContextRegistry();
    registry.register(ctx('tool-x', 'tool'));
    registry.register(ctx('skill-a', 'skill', ['tool-x']));

    const patches = new DefaultPatchProposer(registry).propose([
      failure({ role: 'introducer', kind: 'tool', ref: 'tool-x' }),
      failure({ role: 'introducer', kind: 'tool', ref: 'tool-x' }),
    ]);

    expect(patches).toHaveLength(1);
  });
});
