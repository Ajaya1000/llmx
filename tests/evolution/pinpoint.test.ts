import { describe, expect, it } from 'vitest';
import {
  DefaultPinpointer,
  toCulprit,
  toLocation,
} from '../../src/evolution/pinpoint.ts';
import { InMemoryContextRegistry } from '../../src/evolution/store/context-registry.ts';
import { InMemoryTrajectoryStore } from '../../src/evolution/store/trajectory.ts';
import type {
  Context,
  ContextKind,
  TaskEvent,
} from '../../src/evolution/types.ts';

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

function ctx(id: string, kind: ContextKind, dependsOn: string[] = []): Context {
  return { id, kind, content: '', dependsOn };
}

/** tool-x (first) and tool-y (second) both used; the fact came from tool-y. */
function setup() {
  const registry = new InMemoryContextRegistry();
  registry.register(ctx('tool-x', 'tool'));
  registry.register(ctx('tool-y', 'tool'));
  registry.register(ctx('skill-a', 'skill', ['tool-y']));

  const store = new InMemoryTrajectoryStore();
  store.onTask(task({ id: 'relay' }));
  store.onTask(
    task({
      id: 'leaf',
      kind: 'tool_call',
      parentId: 'relay',
      contextsUsed: [
        { contextId: 'tool-x', version: 'v1', recordRef: 'ctx-x' },
        { contextId: 'tool-y', version: 'v1', recordRef: 'ctx-y' },
      ],
    }),
  );
  store.record({
    id: 'ctx-x',
    taskId: 'leaf',
    role: 'context_injection',
    content: 'tool-x description',
  });
  store.record({
    id: 'ctx-y',
    taskId: 'leaf',
    role: 'context_injection',
    content: 'tool-y description',
  });
  store.record({
    id: 'tool-out',
    taskId: 'leaf',
    role: 'tool_result',
    contextId: 'tool-y',
    content: 'the wrong fact',
  });
  store.record({
    id: 'relay-out',
    taskId: 'relay',
    role: 'assistant',
    content: 'using the wrong fact',
  });

  return { registry, store };
}

describe('DefaultPinpointer', () => {
  it('pinpoints the introducing tool, its propagation, and blast radius', () => {
    const { registry, store } = setup();
    const blame = new DefaultPinpointer(store, registry).pinpoint('wrong');

    expect(blame?.culprit.id).toBe('leaf');
    expect(blame?.culpritKind).toBe('tool');
    // the emitting tool (tool-y), not the first tool in contextsUsed (tool-x)
    expect(blame?.culpritContextId).toBe('tool-y');
    expect(blame?.propagators).toEqual(['relay']);
    expect(blame?.ancestors).toEqual(['relay']);
    expect(blame?.dependents).toEqual(['skill-a']);
    expect(blame?.missedDetectors).toEqual([]);
  });

  it('resolves a record ref and produces a structured location', () => {
    const { registry, store } = setup();
    const pinpointer = new DefaultPinpointer(store, registry);

    const location = pinpointer.locateRecord('tool-out');
    if (!location) throw new Error('expected location');
    expect(location.fact).toBe('the wrong fact');
    expect(location.culprit).toEqual({
      role: 'introducer',
      kind: 'tool',
      ref: 'tool-y',
    });
    expect(location.dependents).toEqual(['skill-a']);

    const blame = pinpointer.pinpointRecord('tool-out');
    if (!blame) throw new Error('expected blame');
    expect(toCulprit(blame)).toEqual(location.culprit);
    expect(toLocation(blame, 'the wrong fact')).toEqual(location);
  });

  it('flags validators that saw the fact and passed as missed detectors', () => {
    const { registry, store } = setup();
    store.onTask(
      task({ id: 'check-pass', kind: 'validation', inputRefs: ['tool-out'] }),
    );
    store.onTask(
      task({
        id: 'check-fail',
        kind: 'validation',
        inputRefs: ['tool-out'],
        status: 'failed',
      }),
    );

    const blame = new DefaultPinpointer(store, registry).pinpoint('wrong');

    expect(blame?.missedDetectors).toEqual(['check-pass']);
  });
});
