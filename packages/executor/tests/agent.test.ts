import { describe, expect, it } from 'vitest';
import { TaskExecutor } from '../src/agent/agent.ts';
import type { AgentDefinition } from '../src/agent/agents.ts';
import { DefaultTaskExecutorFactory } from '../src/agent/taskExecutorFactory.ts';
import { createSpawnAgentTool } from '../src/durable/spawn-tool.ts';
import { InMemoryWikiMaintainer } from '../src/mission/wiki.ts';
import type { AgentRunContext, MissionUi } from '../src/types.ts';

function bareDef(
  overrides: Partial<AgentDefinition> & { id: string },
): AgentDefinition {
  return {
    title: overrides.id,
    description: 'test agent',
    preState: {},
    postState: {},
    tools: [],
    edges: [],
    metadata: { created: '' },
    domain: 'test',
    body: 'do the thing',
    ...overrides,
  };
}

interface FakeUiEvents {
  started: Array<{ agentId: string; task: string }>;
  finished: Array<{ agentId: string; text: string }>;
  events: Array<{ agentId: string; type: string; toolName?: string }>;
}

function fakeUi(events: FakeUiEvents): MissionUi {
  return {
    agentStarted(agentId, task): void {
      events.started.push({ agentId, task });
    },
    agentFinished(agentId, text): void {
      events.finished.push({ agentId, text });
    },
    agentEvent(agentId, event): void {
      events.events.push({
        agentId,
        type: event.type,
        toolName: event.toolName,
      });
    },
  };
}

interface FakeSessionOptions {
  text?: string;
  /** The run context getRunContext() reports. */
  runContext?: AgentRunContext;
  /** Events the fake session delivers to subscribers during prompt(). */
  emitsDuringPrompt?: Array<{ type: string; toolName?: string }>;
  /** When set, prompt() rejects with this message. */
  throwDuringPrompt?: string;
}

class FakeSession {
  readonly messages: unknown[] = [];
  readonly seeds: string[] = [];
  readonly listeners: Array<
    (event: { type: string; toolName?: string }) => void
  > = [];
  disposeCount = 0;
  text: string;
  readonly runContext: AgentRunContext;
  readonly emitsDuringPrompt: Array<{ type: string; toolName?: string }>;
  readonly throwDuringPrompt?: string;

  constructor(options: FakeSessionOptions = {}) {
    this.text = options.text ?? 'child summary';
    this.runContext = options.runContext ?? { tools: [] };
    this.emitsDuringPrompt = options.emitsDuringPrompt ?? [];
    this.throwDuringPrompt = options.throwDuringPrompt;
  }

  getLastAssistantText(): string | undefined {
    return this.text;
  }

  getRunContext(): AgentRunContext {
    return this.runContext;
  }

  subscribe(
    listener: (event: { type: string; toolName?: string }) => void,
  ): () => void {
    this.listeners.push(listener);
    return () => this.listeners.splice(this.listeners.indexOf(listener), 1);
  }

  async prompt(text: string): Promise<void> {
    this.seeds.push(text);
    if (this.throwDuringPrompt) throw new Error(this.throwDuringPrompt);
    for (const event of this.emitsDuringPrompt) {
      for (const listener of [...this.listeners]) listener(event);
    }
  }

  dispose(): void {
    this.disposeCount += 1;
  }
}

function fakeRepository(session: FakeSession) {
  return {
    createSession: async () => session,
  } as never;
}

const childTrajectory = {
  agentId: 'explore',
  task: 'recon',
  depth: 1,
  steps: [],
};

describe('InMemoryWikiMaintainer', () => {
  it('records entries, returns lessons only, and exposes all entries', () => {
    const wiki = new InMemoryWikiMaintainer();
    wiki.recordEntry('agent-1', 'lesson', 'always stash before rebase');
    wiki.recordEntry('agent-1', 'failure', 'detached HEAD');

    const lessons = wiki.lessons();
    const all = wiki.allEntries();

    expect(lessons).toHaveLength(1);
    expect(lessons[0].kind).toBe('lesson');
    expect(lessons[0].content).toBe('always stash before rebase');
    expect(lessons[0].agentId).toBe('agent-1');
    expect(lessons[0].createdAt).toBeGreaterThan(0);
    expect(all).toHaveLength(2);
    expect(all[1].kind).toBe('failure');
  });
});

describe('TaskExecutor', () => {
  it('throws when reading messages or final text before run()', () => {
    const agent = new TaskExecutor({
      agentId: 'agent-1',
      task: 'test',
      definition: bareDef({ id: 'agent-1' }),
      depth: 0,
      ui: fakeUi({ started: [], finished: [], events: [] }),
    });

    expect(() => agent.getMessages()).toThrow('has not run yet');
    expect(() => agent.getFinalText()).toThrow('has not run yet');
  });

  it('runs a session, seeds the composed prompt, and reports the run result', async () => {
    const events: FakeUiEvents = { started: [], finished: [], events: [] };
    const def = bareDef({
      id: 'tracker',
      title: 'Tracker',
      description: 'keeps watch',
      body: 'follow the procedure',
    });
    const session = new FakeSession({ text: 'final summary' });
    const agent = new TaskExecutor({
      agentId: 'agent-1',
      task: 'watch the repo',
      definition: def,
      depth: 2,
      maxSpawnDepth: 8,
      repository: fakeRepository(session),
      ui: fakeUi(events),
    });

    const result = await agent.run();

    expect(result.agentId).toBe('agent-1');
    expect(result.text).toBe('final summary');
    expect(result.transcript).toEqual([]);
    expect(events.started).toEqual([
      { agentId: 'agent-1', task: 'watch the repo' },
    ]);
    expect(events.finished).toEqual([
      { agentId: 'agent-1', text: 'final summary' },
    ]);

    const seed = session.seeds[0];
    expect(seed).toContain('You are agent-1 — Tracker:');
    expect(seed).toContain('keeps watch');
    expect(seed).toContain('Pre-state (advisory): {}');
    expect(seed).toContain('Post-state: {}');
    expect(seed).toContain('## Procedure');
    expect(seed).toContain('follow the procedure');
    expect(seed).toContain('watch the repo');

    expect(agent.getFinalText()).toBe('final summary');
    expect(agent.getMessages()).toEqual([]);
  });

  it('exposes the subagent roster and strict delegation policy in the seed', async () => {
    const session = new FakeSession({ text: 'ok' });
    const agent = new TaskExecutor({
      agentId: 'root',
      task: 't',
      definition: bareDef({
        id: 'root',
        edges: [
          {
            id: 'e1',
            target: 'explore',
            forwardDescription: 'hand over the repo state',
            backwardDescription: '',
            condition: 'always',
          },
        ],
      }),
      depth: 0,
      repository: fakeRepository(session),
      ui: fakeUi({ started: [], finished: [], events: [] }),
      spawn: async () => undefined,
      subagents: [
        bareDef({
          id: 'explore',
          title: 'Explorer',
          description: 'scans the repo',
        }),
      ],
    });

    await agent.run();

    const seed = session.seeds[0];
    expect(seed).toContain('## Available subagents (via spawn_agent)');
    expect(seed).toContain('- explore — Explorer: scans the repo.');
    expect(seed).toContain('Entering note: hand over the repo state');
    expect(seed).toContain('## Delegation policy — strict');
    expect(seed).toContain(
      'you MUST delegate that step with spawn_agent. Never perform such a step yourself.',
    );
    expect(seed).toContain(
      'Solve a step yourself only when no listed subagent covers it.',
    );
  });

  it('omits every spawn_agent mention from the seed when it cannot spawn', async () => {
    const session = new FakeSession({ text: 'ok' });
    const agent = new TaskExecutor({
      agentId: 'leaf',
      task: 't',
      definition: bareDef({ id: 'leaf' }),
      depth: 0,
      repository: fakeRepository(session),
      ui: fakeUi({ started: [], finished: [], events: [] }),
    });

    await agent.run();

    expect(session.seeds[0]).not.toContain('spawn_agent');
  });

  it('forwards session events emitted during the prompt to the ui for this agent', async () => {
    const events: FakeUiEvents = { started: [], finished: [], events: [] };
    const session = new FakeSession({
      emitsDuringPrompt: [
        { type: 'tool_execution_start', toolName: 'spawn_agent' },
        { type: 'tool_execution_end', toolName: 'spawn_agent' },
      ],
    });
    const agent = new TaskExecutor({
      agentId: 'agent-1',
      task: 't',
      definition: bareDef({ id: 'tracker' }),
      depth: 0,
      repository: fakeRepository(session),
      ui: fakeUi(events),
    });

    await agent.run();

    expect(events.events).toEqual([
      {
        agentId: 'agent-1',
        type: 'tool_execution_start',
        toolName: 'spawn_agent',
      },
      {
        agentId: 'agent-1',
        type: 'tool_execution_end',
        toolName: 'spawn_agent',
      },
    ]);
  });

  it('unsubscribes its listener after the prompt and dispose() disposes the session', async () => {
    const events: FakeUiEvents = { started: [], finished: [], events: [] };
    const session = new FakeSession();
    const agent = new TaskExecutor({
      agentId: 'agent-1',
      task: 't',
      definition: bareDef({ id: 'tracker' }),
      depth: 0,
      repository: fakeRepository(session),
      ui: fakeUi(events),
    });

    await agent.run();
    expect(session.listeners).toHaveLength(0);
    agent.dispose();
    expect(session.disposeCount).toBe(1);
    expect(() => agent.getMessages()).toThrow('has not run yet');
  });
});

describe('DefaultTaskExecutorFactory', () => {
  const baseOptions = {
    ui: fakeUi({ started: [], finished: [], events: [] }),
    repository: { createSession: async () => new FakeSession() } as never,
  };

  it('refuses to create agents at or beyond the max spawn depth', () => {
    const factory = new DefaultTaskExecutorFactory({
      ...baseOptions,
      agentDefs: [bareDef({ id: 'explore' })],
      maxSpawnDepth: 2,
    });

    expect(() =>
      factory.create({ task: 't', agentId: 'explore', depth: 2 }),
    ).toThrow('nesting depth limit (2) reached');
    expect(() =>
      factory.create({ task: 't', agentId: 'explore', depth: 3 }),
    ).toThrow('Complete the task yourself');
  });

  it('rejects agent ids without a loaded definition', () => {
    const factory = new DefaultTaskExecutorFactory({
      ...baseOptions,
      agentDefs: [bareDef({ id: 'explore' })],
      maxSpawnDepth: 8,
    });

    expect(() =>
      factory.create({ task: 't', agentId: 'ghost', depth: 0 }),
    ).toThrow('Unknown agent id "ghost". Available definitions: explore.');
    expect(() =>
      new DefaultTaskExecutorFactory({
        ...baseOptions,
        agentDefs: [],
        maxSpawnDepth: 8,
      }).create({ task: 't', agentId: 'ghost', depth: 0 }),
    ).toThrow('Available definitions: none.');
  });

  it('creates a TaskExecutor bound to the matched definition', () => {
    const factory = new DefaultTaskExecutorFactory({
      ...baseOptions,
      agentDefs: [bareDef({ id: 'explore' })],
      maxSpawnDepth: 8,
    });

    const child = factory.create({
      task: 'look',
      agentId: 'explore',
      depth: 1,
    });
    expect(child.agentId).toBe('explore');
  });

  it('seeds the executor with the subagent roster its edges allow (and only those)', async () => {
    const session = new FakeSession({ text: 'ok' });
    const factory = new DefaultTaskExecutorFactory({
      ui: fakeUi({ started: [], finished: [], events: [] }),
      repository: fakeRepository(session),
      agentDefs: [
        bareDef({
          id: 'root',
          edges: [
            {
              id: 'e1',
              target: 'explore',
              forwardDescription: '',
              backwardDescription: '',
              condition: 'always',
            },
            {
              id: 'e2',
              target: 'dig',
              forwardDescription: '',
              backwardDescription: '',
              condition: 'always',
            },
          ],
        }),
        bareDef({ id: 'explore', title: 'Explorer' }),
        bareDef({ id: 'dig', title: 'Digger' }),
        bareDef({ id: 'rogue', title: 'Rogue' }),
      ],
      maxSpawnDepth: 8,
    });

    const root = factory.create({ task: 't', agentId: 'root', depth: 0 });
    await root.run();

    const seed = session.seeds[0];
    expect(seed).toContain('- explore — Explorer:');
    expect(seed).toContain('- dig — Digger:');
    expect(seed).not.toContain('rogue');
  });

  it('seeds an edge-less executor with every other loaded agent as subagent', async () => {
    const session = new FakeSession({ text: 'ok' });
    const factory = new DefaultTaskExecutorFactory({
      ui: fakeUi({ started: [], finished: [], events: [] }),
      repository: fakeRepository(session),
      agentDefs: [
        bareDef({ id: 'root', title: 'Root' }),
        bareDef({ id: 'explore', title: 'Explorer' }),
      ],
      maxSpawnDepth: 8,
    });

    const root = factory.create({ task: 't', agentId: 'root', depth: 0 });
    await root.run();

    expect(session.seeds[0]).toContain('- explore — Explorer:');
  });
});

describe('spawn (factory edge policy)', () => {
  const events: FakeUiEvents = { started: [], finished: [], events: [] };

  function factoryWith(
    agentDefs: AgentDefinition[],
    session: FakeSession = new FakeSession(),
  ) {
    return new DefaultTaskExecutorFactory({
      ui: fakeUi(events),
      repository: fakeRepository(session),
      agentDefs,
      maxSpawnDepth: 8,
    });
  }

  it('refuses spawning agents outside the parent declared edges', async () => {
    const parentDef = bareDef({
      id: 'debug-agent',
      edges: [
        {
          id: 'e1',
          target: 'explore',
          forwardDescription: '',
          backwardDescription: '',
          condition: 'always',
        },
      ],
    });
    const factory = factoryWith([parentDef]);

    await expect(
      factory.spawn({
        parentAgentId: 'debug-agent',
        parentDepth: 0,
        callId: 'c1',
        agent: 'rogue',
        task: 'nope',
      }),
    ).rejects.toThrow(
      'spawn_agent refused: "debug-agent" may only spawn [explore]',
    );
  });

  it('spawns an allowed child and returns its output and trajectory', async () => {
    const session = new FakeSession({ text: 'child done' });
    const factory = factoryWith([bareDef({ id: 'explore' })], session);

    const spawned = await factory.spawn({
      parentAgentId: 'root',
      parentDepth: 2,
      callId: 'c1',
      agent: 'explore',
      task: 'recon',
    });

    expect(spawned?.text).toBe('child done');
    expect(spawned?.trajectory).toEqual({
      agentId: 'explore',
      task: 'recon',
      depth: 3,
      context: { tools: [] },
      transcript: [],
      steps: [],
    });
    expect(session.seeds[0]).toContain('recon');
  });

  it('falls back to the empty-output marker when the child returns nothing', async () => {
    const factory = factoryWith(
      [bareDef({ id: 'explore' })],
      new FakeSession({ text: '' }),
    );

    expect(
      await factory.spawn({
        parentAgentId: 'root',
        parentDepth: 0,
        callId: 'c1',
        agent: 'explore',
        task: 't',
      }),
    ).toMatchObject({ text: '(no output)' });
  });

  it('wraps child failures in a named error', async () => {
    const factory = factoryWith(
      [bareDef({ id: 'explore' })],
      new FakeSession({ throwDuringPrompt: 'boom from explore' }),
    );

    await expect(
      factory.spawn({
        parentAgentId: 'root',
        parentDepth: 0,
        callId: 'c1',
        agent: 'explore',
        task: 't',
      }),
    ).rejects.toThrow('Agent explore failed: Error: boom from explore');
  });
});

describe('spawn_agent tool (durable registration)', () => {
  function toolApi() {
    return {
      snapshot: async () => ({ agentId: 'parent-1', depth: 1 }),
      conversationId: 'conv-1',
      callId: 'call-1',
    } as never;
  }

  it('returns the child text and takes parent context from the agent-context doc', async () => {
    const seen: unknown[] = [];
    const tool = createSpawnAgentTool(async (input) => {
      seen.push(input);
      return { text: 'child summary', trajectory: childTrajectory };
    });

    const result = await tool.execute(
      { agent: 'explore', task: 'recon' },
      toolApi(),
      null,
    );

    expect(result.content).toEqual([{ type: 'text', text: 'child summary' }]);
    expect(seen[0]).toMatchObject({
      parentAgentId: 'parent-1',
      parentDepth: 1,
      callId: 'call-1',
      agent: 'explore',
      task: 'recon',
    });
  });

  it('signals the empty result when the handler returns undefined', async () => {
    const tool = createSpawnAgentTool(async () => undefined);

    const result = await tool.execute(
      { agent: 'explore', task: 't' },
      toolApi(),
      null,
    );

    expect(result.content[0]).toEqual({
      type: 'text',
      text: 'Agent produced no output.',
    });
  });

  it('reports handler failures as error results', async () => {
    const tool = createSpawnAgentTool(async () => {
      throw new Error('Agent explore failed: Error: boom');
    });

    const result = await tool.execute(
      { agent: 'explore', task: 't' },
      toolApi(),
      null,
    );

    expect(result.content[0]).toEqual({
      type: 'text',
      text: 'Spawn failed: Agent explore failed: Error: boom',
    });
    expect(result.isError).toBe(true);
  });
});
