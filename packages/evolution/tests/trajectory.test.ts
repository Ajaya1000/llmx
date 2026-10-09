import { describe, expect, it } from 'vitest';
import {
  allRuns,
  renderedContexts,
  stepKind,
  stepRef,
  stepText,
  type Trajectory,
  type TrajectoryStep,
  toolRef,
  toolsOffered,
  walkTrajectory,
} from '../src/trajectory.ts';

function spawnStep(child: Trajectory): TrajectoryStep {
  return {
    type: 'toolCall',
    id: 'call-1',
    name: 'spawn_agent',
    arguments: { task: child.task },
    result: 'child finished',
    isError: false,
    child,
  };
}

function childRun(agentId: string, steps: TrajectoryStep[]): Trajectory {
  return {
    agentId,
    task: `task of ${agentId}`,
    depth: 1,
    context: { tools: [] },
    steps,
  };
}

describe('walkTrajectory', () => {
  it('expands each spawned child right after its spawn step, carrying the ownership chain', () => {
    const grandchild = childRun('agent-c', [{ type: 'text', text: 'deepest' }]);
    const child = childRun('agent-b', [
      { type: 'text', text: 'child text' },
      spawnStep(grandchild),
    ]);
    const root: Trajectory = {
      agentId: 'agent-a',
      task: 'root task',
      depth: 0,
      context: { tools: [] },
      steps: [
        { role: 'user', content: 'go' },
        { type: 'thinking', thinking: 'plan' },
        spawnStep(child),
        { type: 'text', text: 'done' },
      ],
    };

    const entries = walkTrajectory(root);
    const producers = entries.map((e) => e.run.agentId);
    expect(producers).toEqual([
      'agent-a',
      'agent-a',
      'agent-a',
      'agent-b',
      'agent-b',
      'agent-c',
      'agent-a',
    ]);

    const childEntry = entries.find((e) => e.run.agentId === 'agent-b');
    expect(childEntry?.ancestors).toEqual(['agent-a']);
    const grandchildEntry = entries.find((e) => e.run.agentId === 'agent-c');
    expect(grandchildEntry?.ancestors).toEqual(['agent-b', 'agent-a']);
    expect(entries.at(-1)?.step).toEqual({ type: 'text', text: 'done' });
  });
});

describe('stepText', () => {
  it('extracts the searchable text of every step shape', () => {
    expect(stepText({ role: 'user', content: 'do it' })).toBe('do it');
    expect(
      stepText({
        role: 'user',
        content: [{ type: 'text', text: 'a' }, { type: 'image' }],
      }),
    ).toBe('a');
    expect(
      stepText({ role: 'system', content: [{ type: 'text', text: 'sys' }] }),
    ).toBe('sys');
    expect(stepText({ type: 'text', text: 'answer' })).toBe('answer');
    expect(stepText({ type: 'thinking', thinking: 'hmm' })).toBe('hmm');
    expect(
      stepText({
        type: 'toolCall',
        id: 'c',
        name: 'read',
        arguments: {},
        result: 'file body',
        isError: false,
      }),
    ).toBe('file body');
  });
});

describe('toolsOffered', () => {
  it('merges run-context tools with mid-run additions, first offer winning', () => {
    const run: Trajectory = {
      agentId: 'agent-a',
      task: 't',
      depth: 0,
      context: {
        tools: [
          { name: 'read', description: 'r', parameters: {} },
          { name: 'write', description: 'w', parameters: {} },
        ],
      },
      steps: [
        {
          role: 'system',
          content: '',
          toolsAdded: [{ name: 'spawn', description: 's', parameters: {} }],
        },
        {
          role: 'system',
          content: '',
          toolsAdded: [
            { name: 'read', description: 'later re-offer', parameters: {} },
          ],
        },
      ],
    };

    expect(toolsOffered(run).map((tool) => tool.description)).toEqual([
      'r',
      'w',
      's',
    ]);
  });
});

describe('stepRef and stepKind', () => {
  const run: Trajectory = {
    agentId: 'agent-a',
    task: 't',
    depth: 0,
    context: { tools: [] },
    steps: [
      { role: 'user', content: 'go' },
      { type: 'text', text: 'hi' },
      {
        type: 'toolCall',
        id: 'call-1',
        name: 'read',
        arguments: {},
        result: 'r',
        isError: false,
      },
    ],
  };

  it('gives tool calls their call id, others their position', () => {
    expect(stepRef(run, 0)).toBe('agent-a:0');
    expect(stepRef(run, 1)).toBe('agent-a:1');
    expect(stepRef(run, 2)).toBe('call-1');
  });

  it('classifies every step shape', () => {
    expect(run.steps.map(stepKind)).toEqual(['user', 'text', 'tool']);
  });
});

describe('renderedContexts and allRuns', () => {
  const child = childRun('agent-b', [{ type: 'text', text: 'child text' }]);
  const run: Trajectory = {
    agentId: 'agent-a',
    task: 't',
    depth: 0,
    context: {
      instructions: 'You are the root agent.',
      tools: [{ name: 'read', description: 'reads files', parameters: {} }],
    },
    steps: [spawnStep(child), { type: 'text', text: 'done' }],
  };

  it('renders the agent instruction plus every offered tool', () => {
    expect(renderedContexts(run).map((c) => [c.id, c.kind])).toEqual([
      ['agent-a', 'agent'],
      ['tool:read', 'tool'],
    ]);
    expect(renderedContexts(child)).toEqual([
      { id: 'agent-b', kind: 'agent', content: '' },
    ]);
  });

  it('lists every run node in the tree, root first', () => {
    expect(allRuns(run).map((r) => r.agentId)).toEqual(['agent-a', 'agent-b']);
  });
});

describe('toolRef', () => {
  it('follows the tool: id convention', () => {
    expect(toolRef('read')).toBe('tool:read');
  });
});
