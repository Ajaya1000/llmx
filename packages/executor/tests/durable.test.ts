import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDurableHarness } from '../src/durable/durable-harness.ts';
import { AgentSessionRepository } from '../src/durable/index.ts';
import { createFakeModels } from './helpers/fake-models.ts';

const ctx = BACKGROUND_CONTEXT;

describe('durable sqlite storage (pi-durable)', () => {
  let dir: string;
  let storagePath: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'llmx-durable-'));
    storagePath = join(dir, 'durable.sqlite');
  });

  afterAll(async () => {
    await closeDurableHarness();
    await rm(dir, { recursive: true, force: true });
  });

  it('offers the spawn_agent tool via the registry extension and records its declaration in the transcript', async () => {
    const models = createFakeModels();
    const repository = new AgentSessionRepository();
    const session = await repository.createSession({
      harness: { storagePath, models },
      agentContext: { agentId: 'root', depth: 0 },
      spawn: async () => ({
        text: 'child ran',
        trajectory: {
          agentId: 'child',
          task: 't',
          depth: 1,
          context: { tools: [] },
          transcript: [],
          steps: [],
        },
      }),
    });

    const agent = await session.conversation.agent(ctx);
    expect(agent.tools.map((tool) => tool.name)).toEqual(['spawn_agent']);

    await session.prompt('do it');

    // The system message pi-durable writes carries the declaration the
    // model was offered (description + parameters) — nothing hidden.
    const system = session.messages.find((m) => m.role === 'system');
    const declared = JSON.stringify(system);
    expect(declared).toContain('spawn_agent');
    expect(declared).toContain('Spawn a sub-agent');

    // The session also records the resolved run context — the "tools given".
    const runContext = session.getRunContext();
    expect(runContext.model).toEqual({ provider: 'faux', modelId: 'faux-1' });
    expect(runContext.tools.map((tool) => tool.name)).toEqual(['spawn_agent']);
    expect(runContext.tools[0].description).toContain('sub-agent');
    expect(runContext.tools[0].parameters).toMatchObject({ type: 'object' });
    await session.dispose();
  });

  it('offers no tools to a conversation without a spawn handler', async () => {
    const models = createFakeModels();
    const repository = new AgentSessionRepository();
    const session = await repository.createSession({
      harness: { storagePath, models },
    });

    const agent = await session.conversation.agent(ctx);
    expect(agent.tools).toEqual([]);
    await session.dispose();
  });

  it('persists conversation, doc state, and transcript across close/reopen', async () => {
    const models = createFakeModels();
    const repository = new AgentSessionRepository();

    // Run 1: answer one prompt, then close (seals admission and settles).
    const first = await repository.createSession({
      harness: { storagePath, models },
    });
    const conversationId = first.conversation.id;
    await first.prompt('Hello durable world');
    const answer = first.getLastAssistantText();
    expect(answer).toBe('echo');
    expect(first.messages.length).toBeGreaterThan(0);
    await first.dispose();
    await closeDurableHarness();

    // Run 2: reopen — a fresh conversation is created, and the first transcript persisted to sqlite.
    const second = await repository.createSession({
      harness: { storagePath, models },
    });
    expect(second.conversation.id).not.toBe(conversationId);
    await second.prompt('Second question');
    expect(second.getLastAssistantText()).toBe('echo');

    const harness = second.harness;
    const reopened = await harness.conversation(conversationId, ctx);
    if (!reopened) throw new Error('reopened conversation missing');
    const view = await reopened.context(ctx);
    const texts = view.messages.map((message) =>
      message.role === 'assistant'
        ? message.content
            .map((block) => (block.type === 'text' ? block.text : ''))
            .join('')
        : '',
    );
    expect(texts.some((text) => text.includes('echo'))).toBe(true);
  });
});
