import type { AgentMessage } from '@earendil-works/pi-agent-core';
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
  ToolTrajectoryTrace,
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

/** A pre-built child flow whose own records already nest a grandchild. */
const childTrajectory: AgentTrajectory = {
  flow: 'recon',
  definition: [
    { id: 'explore', type: 'llm', tools: [], task: 'recon', depth: 1 },
    {
      id: 'user:explore',
      type: 'user',
      description: 'Input to explore',
      ownerAgentId: 'explore',
    },
  ],
  traces: [
    { itemRef: 'user:explore', message: 'recon' },
    { itemRef: 'explore', message: { role: 'assistant', content: 'digging' } },
  ],
  sourceRecords: [
    {
      itemRef: 'explore',
      task: 'recon',
      depth: 1,
      context: { tools: [] },
      transcript: [{ role: 'user', content: 'recon', timestamp: 0 }],
      traceMap: [{ transcriptIndex: 0, traceIndex: 0 }],
    },
    {
      itemRef: 'dig',
      task: 'deep recon',
      depth: 2,
      context: { tools: [] },
      transcript: [],
      traceMap: [{ transcriptIndex: 0, traceIndex: 1 }],
    },
  ],
};

/** A raw transcript: system (tool declarations) → user → assistant (toolCall) → toolResult → assistant. */
function transcript(): AgentMessage[] {
  const meta = {
    api: 'test',
    provider: 'test',
    model: 'test',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, sections: {} },
    timestamp: 0,
  };
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
        { type: 'text', text: 'delegating recon' },
        {
          type: 'toolCall',
          id: 'c1',
          name: 'spawn_agent',
          arguments: { agent: 'explore', task: 'recon' },
        },
      ],
      ...meta,
      stopReason: 'toolUse',
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
      ...meta,
      stopReason: 'endTurn',
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
  it('keeps the contributing agents verbatim — raw transcript and run context — in sourceRecords', () => {
    const raw = transcript();
    const trajectory = buildTrajectory({
      agentId: 'root',
      task: 'find the bug',
      depth: 0,
      context: runContext,
      transcript: raw,
    });

    expect(trajectory.sourceRecords).toHaveLength(1);
    const root = trajectory.sourceRecords?.[0];
    if (!root) throw new Error('root source record missing');
    expect(root.itemRef).toBe('root');
    expect(root.task).toBe('find the bug');
    expect(root.depth).toBe(0);
    expect(root.context).toEqual(runContext);
    expect(root.transcript).toEqual(raw);
  });

  it('flattens the child flow under its spawn call and links the definitions', () => {
    const trajectory = buildRoot();

    // Definitions: root, its user input, the tool — then the child's.
    expect(trajectory.definition.map((item) => item.id)).toEqual([
      'root',
      'user:root',
      'tool:spawn_agent',
      'explore',
      'user:explore',
    ]);
    const explore = trajectory.definition[3];
    expect(explore).toMatchObject({
      type: 'llm',
      parentAgentId: 'root',
      spawnCallId: 'c1',
    });

    // Traces: the child's run sits between the spawn call and its result.
    expect(trajectory.traces.map((t) => t.itemRef)).toEqual([
      'root',
      'user:root',
      'root',
      'user:explore',
      'explore',
      'tool:spawn_agent',
      'root',
    ]);
    const spawnResult = trajectory.traces[5] as ToolTrajectoryTrace;
    expect(spawnResult.output).toMatchObject({
      tool_call_id: 'c1',
      isError: false,
      childItemRef: 'explore',
    });

    // Child source records are kept, with trace links re-offset.
    const childRecords = trajectory.sourceRecords ?? [];
    expect(childRecords).toHaveLength(3);
    expect(childRecords[1]).toMatchObject({
      itemRef: 'explore',
      depth: 1,
    });
    expect(childRecords[1].traceMap).toEqual([
      { transcriptIndex: 0, traceIndex: 3 },
    ]);
    expect(childRecords[2]).toMatchObject({
      itemRef: 'dig',
      depth: 2,
      transcript: [],
    });
    expect(childRecords[2].traceMap).toEqual([
      { transcriptIndex: 0, traceIndex: 4 },
    ]);
  });

  it('ignores children whose callId has no matching tool result', () => {
    const trajectory = buildTrajectory({
      agentId: 'root',
      task: 't',
      depth: 0,
      context: runContext,
      transcript: transcript(),
      children: new Map([['ghost-call', childTrajectory]]),
    });

    expect(trajectory.definition.map((item) => item.id)).toEqual([
      'root',
      'user:root',
      'tool:spawn_agent',
    ]);
    expect(trajectory.traces).toHaveLength(5);
    expect(trajectory.sourceRecords).toHaveLength(1);
  });
});

describe('renderTrajectory', () => {
  it('renders the flat flow: header, agents, tool calls, and results', () => {
    const rendered = renderTrajectory(buildRoot());
    const lines = rendered.split('\n');

    expect(lines[0]).toBe('Flow: find the bug');
    expect(lines).toContain('[root] [system] '); // system declarations kept
    expect(lines).toContain('[user:root] > find the bug');
    expect(lines).toContain('[root] delegating recon');
    expect(lineFor(lines, '[tool spawn_agent')).toBeTruthy();
    expect(lines).toContain('[tool:spawn_agent] [tool result] child summary');
    expect(lines).toContain('[explore] digging');
    expect(lines).toContain('[root] found it');
    // the child run sits between the spawn call and its result
    expect(rendered.indexOf('[explore] digging')).toBeLessThan(
      rendered.indexOf('[tool:spawn_agent] [tool result] child summary'),
    );
  });
});

describe('TaskExecutor trajectory wiring', () => {
  it('collects spawned children by callId and flattens them into its own trajectory', async () => {
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
    expect(result.trajectory.definition.map((item) => item.id)).toContain(
      'explore',
    );
    const spawnResult = result.trajectory.traces[5] as ToolTrajectoryTrace;
    expect(spawnResult.output).toMatchObject({
      tool_call_id: 'c1',
      childItemRef: 'explore',
    });
  });
});

// ------------------------------------------------------------------

function lineFor(lines: string[], needle: string): string | undefined {
  return lines.find((line) => line.includes(needle));
}
