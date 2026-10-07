import { describe, expect, it } from 'vitest';
import { InMemoryTrajectoryStore } from '../src/store/trajectory.ts';
import {
  DefaultTrajectoryDistiller,
  type DistilledEntry,
  type Judger,
  PromptedJudger,
  type Run,
} from '../src/trajectory-distiller.ts';
import type { TaskEvent, TranscriptRecord } from '../src/types.ts';

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

describe('DefaultTrajectoryDistiller', () => {
  it('collects judger rows into the distilled log', async () => {
    const store = new InMemoryTrajectoryStore();
    store.onTask(task({ id: 'run1' }));

    const judger: Judger = {
      distill: async (): Promise<DistilledEntry[]> => [
        { kind: 'strategy', polarity: 'positive', content: 'do X' },
      ],
    };
    const log = await new DefaultTrajectoryDistiller(judger).distill(store);

    expect(log.rows).toHaveLength(1);
    expect(log.rows[0].kind).toBe('strategy');
    expect(log.rows[0].refs.taskId).toBe('run1');
  });

  it('assembles a run with subtree tasks and transcript records', async () => {
    const store = new InMemoryTrajectoryStore();
    store.onTask(task({ id: 'run1' }));
    store.onTask(task({ id: 'tool1', parentId: 'run1', kind: 'tool_call' }));
    store.record({
      id: 'r1',
      taskId: 'tool1',
      role: 'tool_result',
      content: 'x',
    });
    store.record({ id: 'r2', taskId: 'run1', role: 'assistant', content: 'y' });

    let captured: Run | undefined;
    const judger: Judger = {
      distill: async (run) => {
        captured = run;
        return [];
      },
    };
    await new DefaultTrajectoryDistiller(judger).distill(store);

    expect(captured?.root.id).toBe('run1');
    expect(captured?.tasks.map((t) => t.id)).toEqual(['tool1']);
    expect(captured?.records.map((r) => r.id).sort()).toEqual(['r1', 'r2']);
  });
});

describe('PromptedJudger (framework-owned judging prompt)', () => {
  const model = (reply: () => string) => ({ complete: async () => reply() });

  function run(records: TranscriptRecord[], contextIds: string[]): Run {
    return {
      root: task({ id: 'run1' }),
      tasks: [
        task({
          id: 'run1',
          contextsUsed: contextIds.map((contextId) => ({
            contextId,
            version: '0',
            recordRef: 'r',
          })),
        }),
      ],
      records,
    };
  }

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
            culprit: {
              role: 'introducer',
              kind: 'agent',
              ref: 'agent:writer',
            },
          },
        ]);
      },
    });

    const entries = await judger.distill(
      run(
        [
          {
            id: 'r1',
            taskId: 'run1',
            role: 'assistant',
            content: 'the earth is flat',
          },
        ],
        ['agent:writer'],
      ),
    );

    // The prompt is framework-built: grounded rules + rendered contexts + transcript.
    expect(seenPrompt).toContain('never invent facts');
    expect(seenPrompt).toContain('agent:writer');
    expect(seenPrompt).toContain('the earth is flat');
    expect(seenPrompt).toContain('JSON array');

    expect(entries).toHaveLength(1);
    expect(entries[0]?.culprit?.ref).toBe('agent:writer');
  });

  it('strips culprit refs the run never rendered and invalid rows', async () => {
    const judger = new PromptedJudger(
      model(() =>
        JSON.stringify([
          {
            kind: 'failure',
            content: 'grounded fact',
            culprit: { role: 'introducer', kind: 'agent', ref: 'agent:ghost' },
          },
          { kind: 'nonsense', content: 'dropped' },
          { kind: 'lesson', content: 'kept, no culprit' },
        ]),
      ),
    );

    const entries = await judger.distill(
      run(
        [
          {
            id: 'r1',
            taskId: 'run1',
            role: 'assistant',
            content: 'grounded fact',
          },
        ],
        ['agent:writer'],
      ),
    );

    expect(entries).toHaveLength(2);
    expect(entries[0]?.culprit).toBeUndefined(); // ghost ref stripped
    expect(entries[1]?.kind).toBe('lesson');
  });

  it('throws on malformed model output (no silent judging)', async () => {
    const judger = new PromptedJudger(
      model(() => 'I think this run was fine.'),
    );
    await expect(
      judger.distill(
        run(
          [{ id: 'r1', taskId: 'run1', role: 'assistant', content: 'x' }],
          [],
        ),
      ),
    ).rejects.toThrow(/JSON array/);
  });
});
