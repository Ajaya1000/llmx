import { describe, expect, it } from 'vitest';
import type { Trajectory } from '../src/trajectory.ts';
import {
  buildRunView,
  DefaultTrajectoryDistiller,
  type DistilledEntry,
  type Judger,
  PromptedJudger,
  type RunView,
} from '../src/trajectory-distiller.ts';

/** One run: root spawns a child that calls a tool; the root adds a tool mid-run. */
function trajectory(): Trajectory {
  return {
    agentId: 'agent-a',
    task: 'root task',
    depth: 0,
    context: {
      instructions: 'You are the root agent.',
      tools: [{ name: 'read', description: 'reads files', parameters: {} }],
    },
    steps: [
      { role: 'system', content: 'You are the root agent.' },
      { role: 'user', content: 'go' },
      {
        role: 'system',
        content: '',
        toolsAdded: [
          { name: 'spawn', description: 'spawns agents', parameters: {} },
        ],
      },
      {
        type: 'toolCall',
        id: 'call-spawn',
        name: 'spawn',
        arguments: { task: 'child task' },
        result: 'child finished',
        isError: false,
        child: {
          agentId: 'agent-b',
          task: 'child task',
          depth: 1,
          context: { instructions: 'You are the child agent.', tools: [] },
          steps: [
            { role: 'user', content: 'check' },
            {
              type: 'toolCall',
              id: 'call-tool',
              name: 'tool-y',
              arguments: { q: 1 },
              result: 'the wrong fact',
              isError: false,
            },
          ],
        },
      },
      { type: 'text', text: 'done' },
    ],
  };
}

describe('buildRunView (the traditional-code half)', () => {
  it('keeps every step, renders contexts, and makes the implicit edges explicit', () => {
    const view = buildRunView(trajectory());

    expect(view.runId).toBe('agent-a');
    expect(view.steps.map((s) => s.ref)).toEqual([
      'agent-a:0',
      'agent-a:1',
      'agent-a:2',
      'call-spawn',
      'agent-b:0',
      'call-tool',
      'agent-a:4',
    ]);
    expect(view.steps.map((s) => s.kind)).toEqual([
      'system',
      'user',
      'system',
      'tool',
      'user',
      'tool',
      'text',
    ]);
    expect(view.steps[5]?.text).toBe('the wrong fact'); // lossless text
    expect(view.steps[5]?.tool?.name).toBe('tool-y');

    expect(view.contexts.map((c) => c.id)).toEqual([
      'agent-a',
      'tool:read',
      'tool:spawn',
      'agent-b',
    ]);
    expect(view.edges).toContainEqual({
      from: 'call-spawn',
      to: 'agent-b',
      kind: 'spawned',
    });
    expect(view.edges).toContainEqual({
      from: 'agent-a',
      to: 'tool:read',
      kind: 'used',
    });
    expect(view.edges).toContainEqual({
      from: 'agent-a',
      to: 'tool:spawn', // mid-run addition, still an edge
      kind: 'used',
    });
  });
});

describe('DefaultTrajectoryDistiller', () => {
  it("pairs the built view with the judger's observations", async () => {
    let seen: RunView | undefined;
    const judger: Judger = {
      distill: async (view) => {
        seen = view;
        return [
          {
            kind: 'failure',
            polarity: 'negative',
            content: 'the wrong fact',
            culprit: { role: 'introducer', kind: 'tool', ref: 'tool:tool-y' },
            stepRef: 'call-tool',
          },
        ] satisfies DistilledEntry[];
      },
    };

    const run = await new DefaultTrajectoryDistiller(judger).distill(
      trajectory(),
    );

    expect(run.view).toBe(seen);
    expect(run.entries[0]?.stepRef).toBe('call-tool');
  });
});

describe('PromptedJudger (framework-owned observing prompt)', () => {
  const model = (reply: () => string) => ({ complete: async () => reply() });

  it('sends the framework prompt and parses the model reply', async () => {
    let seenPrompt = '';
    const judger = new PromptedJudger({
      complete: async (prompt) => {
        seenPrompt = prompt;
        return JSON.stringify([
          {
            kind: 'failure',
            polarity: 'negative',
            content: 'the earth is flat',
            culprit: { role: 'introducer', kind: 'agent', ref: 'agent:writer' },
          },
        ]);
      },
    });

    const entries = await judger.distill({
      runId: 'agent:writer',
      task: 't',
      contexts: [{ id: 'agent:writer', kind: 'agent', content: 'write' }],
      steps: [
        {
          ref: 'agent:writer:0',
          agentId: 'agent:writer',
          kind: 'text',
          text: 'the earth is flat',
        },
      ],
      edges: [],
    });

    // The prompt is framework-built: grounded rules + contexts + steps.
    expect(seenPrompt).toContain('never invent facts');
    expect(seenPrompt).toContain('agent:writer');
    expect(seenPrompt).toContain('the earth is flat');
    expect(seenPrompt).toContain('JSON array');

    expect(entries).toHaveLength(1);
    expect(entries[0]?.culprit?.ref).toBe('agent:writer');
  });

  it('strips culprit refs and step refs the view never rendered', async () => {
    const judger = new PromptedJudger(
      model(() =>
        JSON.stringify([
          {
            kind: 'failure',
            content: 'grounded fact',
            culprit: { role: 'introducer', kind: 'agent', ref: 'agent:ghost' },
            stepRef: 'agent:ghost:9',
          },
          { kind: 'nonsense', content: 'dropped' },
          { kind: 'lesson', content: 'kept, no culprit' },
        ]),
      ),
    );

    const entries = await judger.distill({
      runId: 'agent:writer',
      task: 't',
      contexts: [{ id: 'agent:writer', kind: 'agent', content: 'write' }],
      steps: [
        {
          ref: 'agent:writer:0',
          agentId: 'agent:writer',
          kind: 'text',
          text: 'grounded fact',
        },
      ],
      edges: [],
    });

    expect(entries).toHaveLength(2);
    expect(entries[0]?.culprit).toBeUndefined(); // ghost ref stripped
    expect(entries[0]?.stepRef).toBeUndefined(); // unknown step stripped
    expect(entries[1]?.kind).toBe('lesson');
  });

  it('throws on malformed model output (no silent judging)', async () => {
    const judger = new PromptedJudger(
      model(() => 'I think this run was fine.'),
    );
    await expect(
      judger.distill({
        runId: 'r',
        task: 't',
        contexts: [],
        steps: [],
        edges: [],
      }),
    ).rejects.toThrow(/JSON array/);
  });
});
