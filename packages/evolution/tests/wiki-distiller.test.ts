import { describe, expect, it } from 'vitest';
import type { Trajectory } from '../src/trajectory.ts';
import type { DistilledRun } from '../src/trajectory-distiller.ts';
import { buildRunView } from '../src/trajectory-distiller.ts';
import { PromptedWikiAgent } from '../src/wiki-distiller.ts';
import type { WikiRow } from '../src/wiki-types.ts';

function response(): DistilledRun {
  const trajectory: Trajectory = {
    agentId: 'agent:writer',
    task: 'write the report',
    depth: 0,
    context: { instructions: 'You are a careful writer.', tools: [] },
    steps: [
      { role: 'user', content: 'write it' },
      { type: 'text', text: 'the earth is flat' },
    ],
  };
  return {
    view: buildRunView(trajectory),
    entries: [
      {
        kind: 'failure',
        polarity: 'negative',
        content: 'the earth is flat',
        culprit: { role: 'introducer', kind: 'agent', ref: 'agent:writer' },
      },
    ],
  };
}

const prior: WikiRow[] = [
  {
    id: 'agent:editor:0',
    runId: 'agent:editor',
    kind: 'lesson',
    author: { kind: 'agent', agentId: 'agent:editor' },
    refs: {},
    content: 'verify shapes before writing',
    useCount: 3,
    lastUsedAt: 1,
    createdAt: 1,
  },
];

describe("PromptedWikiAgent (the wiki's LLM agent)", () => {
  it('sends prior rows plus the responses and parses structured rows back', async () => {
    let seenPrompt = '';
    const agent = new PromptedWikiAgent({
      complete: async (prompt) => {
        seenPrompt = prompt;
        return JSON.stringify([
          {
            kind: 'pattern',
            content: 'claims skip verification across runs',
            runId: 'agent:writer',
            culprit: { role: 'introducer', kind: 'agent', ref: 'agent:writer' },
          },
        ]);
      },
    });

    const rows = await agent.distill([response()], prior);

    // The prompt carries the prior knowledge and the run's observations.
    expect(seenPrompt).toContain('verify shapes before writing');
    expect(seenPrompt).toContain('the earth is flat');
    expect(seenPrompt).toContain('generalize');

    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('pattern');
    expect(rows[0]?.runId).toBe('agent:writer');
    expect(rows[0]?.id).toBe('agent:writer:0');
    expect(rows[0]?.author).toEqual({ kind: 'agent', agentId: 'agent:writer' });
  });

  it('strips rows the responses cannot ground (unknown run, unrendered culprit)', async () => {
    const agent = new PromptedWikiAgent({
      complete: async () =>
        JSON.stringify([
          {
            kind: 'lesson',
            content: 'from a run that never happened',
            runId: 'agent:ghost',
          },
          {
            kind: 'failure',
            content: 'culprit never rendered',
            runId: 'agent:writer',
            culprit: { role: 'introducer', kind: 'agent', ref: 'agent:ghost' },
          },
          { kind: 'lesson', content: 'kept', runId: 'agent:writer' },
        ]),
    });

    const rows = await agent.distill([response()], []);

    // the unknown-run row is dropped; the unrendered culprit is stripped but
    // its grounded row survives (the wiki keeps knowledge without blame);
    // the valid row survives intact.
    expect(rows).toHaveLength(2);
    expect(rows[0]?.content).toBe('culprit never rendered');
    expect(rows[0]?.culprit).toBeUndefined();
    expect(rows[1]?.content).toBe('kept');
    expect(rows[1]?.id).toBe('agent:writer:1');
  });

  it('throws on malformed model output (no silent wiki writes)', async () => {
    const agent = new PromptedWikiAgent({
      complete: async () => 'looks fine to me',
    });
    await expect(agent.distill([response()], [])).rejects.toThrow(/JSON array/);
  });
});
