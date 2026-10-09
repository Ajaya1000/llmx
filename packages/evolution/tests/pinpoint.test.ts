import { describe, expect, it } from 'vitest';
import { DefaultPinpointer, toCulprit, toLocation } from '../src/pinpoint.ts';
import { InMemoryContextRegistry } from '../src/store/context-registry.ts';
import type { Trajectory, TrajectoryStep } from '../src/trajectory.ts';
import type { Context, ContextKind } from '../src/types.ts';

function ctx(id: string, kind: ContextKind, dependsOn: string[] = []): Context {
  return { id, kind, content: '', dependsOn };
}

/**
 * Root (agent-a) spawns a child (agent-b) that calls tool:tool-y — the wrong
 * fact first appears in that tool result, and root relays it downstream.
 */
function setup() {
  const registry = new InMemoryContextRegistry();
  registry.register(ctx('tool:tool-x', 'tool'));
  registry.register(ctx('tool:tool-y', 'tool'));
  registry.register(ctx('skill-a', 'skill', ['tool:tool-y']));

  const childSteps: TrajectoryStep[] = [
    { role: 'system', content: 'You are the child agent.' },
    { role: 'user', content: 'check the shape' },
    {
      type: 'toolCall',
      id: 'call-tool-y',
      name: 'tool-y',
      arguments: {},
      result: 'the wrong fact',
      isError: false,
    },
  ];
  const trajectory: Trajectory = {
    agentId: 'agent-a',
    task: 'root task',
    depth: 0,
    context: {
      instructions: 'You are the root agent.',
      tools: [
        { name: 'tool-x', description: 'tool-x description', parameters: {} },
      ],
    },
    steps: [
      { role: 'system', content: 'You are the root agent.' },
      { role: 'user', content: 'go' },
      {
        type: 'toolCall',
        id: 'call-spawn',
        name: 'spawn_agent',
        arguments: { task: 'check the shape' },
        result: 'child finished',
        isError: false,
        child: {
          agentId: 'agent-b',
          task: 'check the shape',
          depth: 1,
          context: {
            instructions: 'You are the child agent.',
            tools: [
              {
                name: 'tool-y',
                description: 'tool-y description',
                parameters: {},
              },
            ],
          },
          steps: childSteps,
        },
      },
      {
        type: 'toolCall',
        id: 'call-relay',
        name: 'tool-x',
        arguments: {},
        result: 'relaying the wrong fact onward',
        isError: false,
      },
      { type: 'text', text: 'using the wrong fact' },
    ],
  };
  return { registry, trajectory };
}

describe('DefaultPinpointer', () => {
  it('pinpoints the introducing tool, its propagation, and blast radius', () => {
    const { registry, trajectory } = setup();
    const blame = new DefaultPinpointer(trajectory, registry).pinpoint('wrong');

    expect(blame?.culprit).toBe('agent-b'); // the run that first carried it
    expect(blame?.culpritKind).toBe('tool');
    expect(blame?.culpritContextId).toBe('tool:tool-y');
    expect(blame?.introducedBy?.stepRef).toBe('call-tool-y');
    expect(blame?.propagators).toEqual(['agent-a']); // relayed downstream
    expect(blame?.ancestors).toEqual(['agent-a']);
    expect(blame?.dependents).toEqual(['skill-a']);
    // tool-x relayed the fact onward without flagging an error
    expect(blame?.missedDetectors).toEqual(['tool:tool-x']);
  });

  it('resolves a step ref and produces a structured location', () => {
    const { registry, trajectory } = setup();
    const pinpointer = new DefaultPinpointer(trajectory, registry);

    const location = pinpointer.locateStep('call-tool-y');
    if (!location) throw new Error('expected location');
    expect(location.fact).toBe('the wrong fact');
    expect(location.culprit).toEqual({
      role: 'introducer',
      kind: 'tool',
      ref: 'tool:tool-y',
    });
    expect(location.dependents).toEqual(['skill-a']);

    const blame = pinpointer.pinpointStep('call-tool-y');
    if (!blame) throw new Error('expected blame');
    expect(toCulprit(blame)).toEqual(location.culprit);
    expect(toLocation(blame, 'the wrong fact')).toEqual(location);
  });

  it('blames the agent context when the agent itself wrote the fact', () => {
    const { registry, trajectory } = setup();
    const blame = new DefaultPinpointer(trajectory, registry).pinpoint(
      'root agent',
    );

    // The fact came from the rendered instructions — the agent's own context.
    expect(blame?.culpritKind).toBe('agent');
    expect(blame?.culpritContextId).toBe('agent-a');
  });

  it('returns null when the fact never appears', () => {
    const { registry, trajectory } = setup();
    expect(
      new DefaultPinpointer(trajectory, registry).pinpoint('absent'),
    ).toBeNull();
  });
});
