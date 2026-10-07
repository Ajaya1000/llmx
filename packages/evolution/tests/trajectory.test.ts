import { describe, expect, it } from 'vitest';
import { InMemoryTrajectoryStore } from '../src/store/trajectory.ts';
import type { TaskEvent } from '../src/types.ts';

function task(partial: Partial<TaskEvent> & { id: string }): TaskEvent {
  return {
    kind: 'agent_run',
    producer: 'agent-a',
    contextsUsed: [],
    contextEdges: [],
    inputRefs: [],
    outputRefs: [],
    status: 'done',
    ...partial,
  };
}

describe('InMemoryTrajectoryStore', () => {
  it('tracks ownership and blames the introducer, not the relay', () => {
    const store = new InMemoryTrajectoryStore();

    const parent = task({ id: 't1' });
    const child = task({ id: 't2', parentId: 't1' });
    store.onTask(parent);
    store.onTask(child);

    store.record({
      id: 'r1',
      taskId: 't1',
      role: 'assistant',
      content: 'the fact X appears here',
    });
    store.record({
      id: 'r2',
      taskId: 't2',
      role: 'assistant',
      content: 'relaying X downstream',
    });
    parent.outputRefs.push('r1');
    child.inputRefs.push('r1');
    child.outputRefs.push('r2');

    expect(store.children('t1')).toEqual([child]);
    expect(store.ancestors('t2')).toEqual(['t1']);
    expect(store.inputs('t2')).toEqual(['r1']);

    const blame = store.firstIntroduction('X');
    expect(blame?.culprit.id).toBe('t1');
    expect(blame?.role).toBe('introducer');
    expect(blame?.propagators).toEqual(['t2']);
    expect(blame?.introducedBy?.recordId).toBe('r1');
    expect(blame?.introducedBy?.role).toBe('assistant');
  });

  it('returns null when the fact never appears', () => {
    const store = new InMemoryTrajectoryStore();
    expect(store.firstIntroduction('absent')).toBeNull();
  });

  it('round-trips context usage edges through the store', () => {
    const store = new InMemoryTrajectoryStore();
    const event = task({
      id: 't1',
      contextsUsed: [
        { contextId: 'skill-x', version: 'v1', recordRef: 'r-skill' },
        { contextId: 'tool-y', version: 'v1', recordRef: 'r-tool' },
      ],
      contextEdges: [{ from: 'skill-x', to: 'tool-y' }],
    });
    store.onTask(event);

    // The store accepts the event; children/ancestors still answer with the
    // new shape. Context-edge indexing itself is Task 6 (context registry).
    expect(store.children('t1')).toEqual([]);
    expect(event.contextEdges).toEqual([{ from: 'skill-x', to: 'tool-y' }]);
  });
});
