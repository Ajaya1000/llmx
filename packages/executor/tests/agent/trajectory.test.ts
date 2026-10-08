import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ThinkingContent } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { TaskExecutor } from '../../src/agent/agent.ts';
import type { AgentDefinition } from '../../src/agent/agents.ts';
import {
  buildTrajectory,
  renderTrajectory,
} from '../../src/agent/trajectory.ts';
import type { SpawnHandler } from '../../src/durable/spawn-tool.ts';
import type {
  AgentRunContext,
  AgentTrajectory,
  MissionUi,
  TrajectoryStep,
} from '../../src/types.ts';

const silentUi: MissionUi = {
  agentStarted(): void {},
  agentFinished(): void {},
  agentEvent(): void {},
};

const def: AgentDefinition = {
  title: 'root',
  description: '',
  preState: {},
  postState: {},
  tools: [],
  edges: [],
  metadata: { created: '' },
  domain: 'test',
  body: '',
  id: 'root',
};

const runContext: AgentRunContext = {
  model: { provider: 'faux', modelId: 'faux-1' },
  tools: [
    {
      name: 'spawn_agent',
      description: 'Spawn a sub-agent for a delegated task.',
      parameters: { type: 'object' },
    },
  ],
};

const childTrajectory: AgentTrajectory = {
  agentId: 'explore',
  task: 'recon',
  depth: 1,
  context: { tools: [] },
  transcript: [{ role: 'user', content: 'recon', timestamp: 0 }],
  steps: [
    { role: 'user', content: 'recon', timestamp: 0 },
    {
      type: 'toolCall',
      id: 'g1',
      name: 'spawn_agent',
      arguments: { agent: 'dig', task: 'deep recon' },
      result: 'grandchild summary',
      isError: false,
      child: {
        agentId: 'dig',
        task: 'deep recon',
        depth: 2,
        context: { tools: [] },
        transcript: [],
        steps: [{ type: 'text', text: 'grandchild summary' }],
      },
    },
  ],
};

/** A raw transcript: system (tool declarations) → user → assistant (thinking, text, toolCall) → toolResult → assistant. */
function transcript(): AgentMessage[] {
  return [
    {
      role: 'system',
      content: '',
      toolsAdded: [
        {
          name: 'spawn_agent',
          description: 'Spawn a sub-agent for a delegated task.',
          parameters: { type: 'object' },
        },
      ],
      timestamp: 0,
    },
    { role: 'user', content: 'find the bug', timestamp: 0 },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'deciding how to approach this' },
        { type: 'text', text: 'delegating recon' },
        {
          type: 'toolCall',
          id: 'c1',
          name: 'spawn_agent',
          arguments: { agent: 'explore', task: 'recon' },
        },
      ],
      api: 'test',
      provider: 'test',
      model: 'test',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        sections: {},
      },
      stopReason: 'toolUse',
      timestamp: 0,
    },
    {
      role: 'toolResult',
      toolCallId: 'c1',
      toolName: 'spawn_agent',
      content: [{ type: 'text', text: 'child summary' }],
      isError: false,
      timestamp: 0,
    },
    {
      role: 'assistant',
      content: [{ type: 'text', text: 'found it' }],
      api: 'test',
      provider: 'test',
      model: 'test',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        sections: {},
      },
      stopReason: 'endTurn',
      timestamp: 0,
    },
  ] as unknown as AgentMessage[];
}

function buildRoot(): AgentTrajectory {
  return buildTrajectory({
    agentId: 'root',
    task: 'find the bug',
    depth: 0,
    context: runContext,
    transcript: transcript(),
    children: new Map([['c1', childTrajectory]]),
  });
}

describe('buildTrajectory', () => {
  it('keeps the run context and raw transcript verbatim, unfiltered', () => {
    const raw = transcript();
    const trajectory = buildTrajectory({
      agentId: 'root',
      task: 'find the bug',
      depth: 0,
      context: runContext,
      transcript: raw,
    });

    expect(trajectory.context).toEqual(runContext);
    expect(trajectory.transcript).toEqual(raw);
    expect(trajectory.transcript[0]).toMatchObject({
      role: 'system',
      toolsAdded: [{ name: 'spawn_agent' }],
    });
  });

  it('turns the transcript into lossless ordered steps with the child nested under its spawn step', () => {
    const trajectory = buildRoot();

    expect(
      trajectory.steps.map((s) => ('role' in s ? s.role : s.type)),
    ).toEqual(['system', 'user', 'thinking', 'text', 'toolCall', 'text']);
    const thinking = trajectory.steps[2] as ThinkingContent;
    expect(thinking.thinking).toBe('deciding how to approach this');
    const tool = trajectory.steps[4] as Extract<
      TrajectoryStep,
      { type: 'toolCall' }
    >;
    expect(tool.name).toBe('spawn_agent');
    expect(tool.result).toBe('child summary');
    expect(tool.child).toEqual(childTrajectory);
    // nesting is deep: the grandchild lives inside the child's own steps
    const childTool = tool.child?.steps[1] as Extract<
      TrajectoryStep,
      { type: 'toolCall' }
    >;
    expect(childTool.child?.agentId).toBe('dig');
    expect(childTool.child?.depth).toBe(2);
  });

  it('ignores children whose callId has no matching tool step', () => {
    const trajectory = buildTrajectory({
      agentId: 'root',
      task: 't',
      depth: 0,
      context: runContext,
      transcript: transcript(),
      children: new Map([['ghost-call', childTrajectory]]),
    });

    for (const step of trajectory.steps) {
      if (!('role' in step) && step.type === 'toolCall')
        expect(step.child).toBeUndefined();
    }
  });
});

describe('renderTrajectory', () => {
  it('indents nested agents by their depth and shows the system tool declarations', () => {
    const rendered = renderTrajectory(buildRoot());
    const lines = rendered.split('\n');

    expect(lines[0]).toMatch(/^\[depth 0\] root -- find the bug$/);
    expect(rendered).toContain('[system] tools: spawn_agent');
    expect(rendered).toContain('~ thinking: deciding how to approach this');
    const childLine = lines.find((l) => l.includes('explore'));
    expect(childLine).toMatch(/^ {2}\[depth 1\] explore/);
    const grandchildLine = lines.find((l) => l.includes('dig'));
    expect(grandchildLine).toMatch(/^ {4}\[depth 2\] dig/);
    // child lines sit below the parent's spawn step, not at parent level
    expect(rendered.indexOf('spawn_agent] child summary')).toBeLessThan(
      rendered.indexOf('explore'),
    );
  });
});

describe('TaskExecutor trajectory wiring', () => {
  it('collects spawned children by callId and nests them in its own trajectory', async () => {
    const raw = transcript();
    const spawnCalls: string[] = [];
    const spawn: SpawnHandler = async (input) => {
      spawnCalls.push(input.callId);
      return { text: 'child summary', trajectory: childTrajectory };
    };

    let sessionSpawn: SpawnHandler | undefined;
    const agent = new TaskExecutor({
      agentId: 'root',
      task: 'find the bug',
      definition: def,
      depth: 0,
      ui: silentUi,
      spawn,
      repository: {
        createSession: async (params: { spawn?: SpawnHandler }) => {
          sessionSpawn = params.spawn;
          return {
            messages: raw,
            getLastAssistantText: () => 'found it',
            getRunContext: () => runContext,
            subscribe: () => () => {},
            prompt: async () => {
              // Simulate the durable tool loop calling spawn_agent (callId c1).
              await sessionSpawn?.({
                parentAgentId: 'root',
                parentDepth: 0,
                callId: 'c1',
                agent: 'explore',
                task: 'recon',
              });
            },
            dispose: () => {},
          };
        },
      } as never,
    });

    const result = await agent.run();

    expect(spawnCalls).toEqual(['c1']);
    expect(result.trajectory.context).toEqual(runContext);
    expect(result.trajectory.transcript).toEqual(raw);
    const tool = result.trajectory.steps.find(
      (s): s is Extract<TrajectoryStep, { type: 'toolCall' }> =>
        !('role' in s) && s.type === 'toolCall',
    );
    expect(tool?.child).toEqual(childTrajectory);
  });
});
