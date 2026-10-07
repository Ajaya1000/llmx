import { describe, expect, it } from 'vitest';
import { Evolution } from '../src/runtime.ts';
import { InMemoryContextStore } from '../src/store/context-store.ts';
import { InMemoryTrajectoryStore } from '../src/store/trajectory.ts';
import type {
  DistilledEntry,
  Judger,
  Run,
} from '../src/trajectory-distiller.ts';
import type { Ref, TaskEvent, TranscriptRecord } from '../src/types.ts';
import type { RunRunner } from '../src/verifier.ts';

/** The authoritative context artifacts the client owns (read & write). */
function contextStore(): InMemoryContextStore {
  return new InMemoryContextStore([
    {
      id: 'agent:writer',
      kind: 'agent',
      content: 'You are a careful writer.',
      dependsOn: ['skill:review'],
    },
    {
      id: 'skill:review',
      kind: 'skill',
      content: 'Review every claim.',
      dependsOn: [],
    },
    {
      id: 'agent:editor',
      kind: 'agent',
      content: 'You are a careful editor.',
      dependsOn: ['agent:writer'],
    },
  ]);
}

/** A trajectory with one failing run: agent:writer used skill:review. */
function failingTrajectory(): InMemoryTrajectoryStore {
  const trajectory = new InMemoryTrajectoryStore();
  const task: TaskEvent = {
    id: 'task:run-1',
    kind: 'agent_run',
    producer: 'root',
    contextsUsed: [
      { contextId: 'agent:writer', version: '0', recordRef: 'rec:writer' },
      { contextId: 'skill:review', version: '0', recordRef: 'rec:review' },
      { contextId: 'agent:editor', version: '0', recordRef: 'rec:editor' },
    ],
    // "from used to" = from depends on to: writer uses review, editor uses writer.
    contextEdges: [
      { from: 'agent:writer', to: 'skill:review' },
      { from: 'agent:editor', to: 'agent:writer' },
    ],
    inputRefs: [],
    outputRefs: [],
    status: 'done',
  };
  trajectory.onTask(task);
  const records: TranscriptRecord[] = [
    {
      id: 'rec:writer',
      taskId: task.id,
      role: 'context_injection',
      content: 'You are a careful writer.',
      contextId: 'agent:writer',
    },
    {
      id: 'rec:review',
      taskId: task.id,
      role: 'context_injection',
      content: 'Review every claim.',
      contextId: 'skill:review',
    },
    {
      id: 'rec:editor',
      taskId: task.id,
      role: 'context_injection',
      content: 'You are a careful editor.',
      contextId: 'agent:editor',
    },
    {
      id: 'rec:bad',
      taskId: task.id,
      role: 'assistant',
      content: 'the earth is flat',
    },
  ];
  for (const record of records) trajectory.record(record);
  return trajectory;
}

/** Judges every run as one failure blamed on agent:writer. */
const judger: Judger = {
  async distill(_run: Run): Promise<DistilledEntry[]> {
    return [
      {
        kind: 'failure',
        polarity: 'negative',
        content: 'the earth is flat',
        culprit: { role: 'introducer', kind: 'agent', ref: 'agent:writer' },
      },
    ];
  },
};

const passRunner: RunRunner = {
  run: () => ({ pass: true, evidenceRefs: [] }),
};

describe('Evolution (composition root)', () => {
  it('never proposes a patch for mentioned source code paths', async () => {
    // The culprit is a rendered source file, mentioned by the client.
    const trajectory = failingTrajectory();
    const sourceJudger: Judger = {
      distill: (_run: Run) => [
        {
          kind: 'failure',
          polarity: 'negative',
          content: 'the earth is flat',
          culprit: {
            role: 'introducer',
            kind: 'agent',
            ref: 'src/tools/grep.ts',
          },
        },
      ],
    };
    const result = await new Evolution({
      contexts: contextStore(),
      trajectory,
      judger: sourceJudger,
      runner: passRunner,
      decide: () => 'approved',
      sourcePaths: ['src/tools'],
    }).run();

    // The failure is judged and kept as wiki knowledge, but nothing is
    // proposed, validated, or approved for source code.
    expect(result.verdicts).toHaveLength(0);
    expect(result.approved).toHaveLength(0);
  });

  it('drives the full loop from a bare trajectory to an approved patch', async () => {
    const seen: Ref[] = [];
    const runner: RunRunner = {
      run: (_original, patched, patch) => {
        seen.push(...patched.map((c) => c.id));
        // The forked run sees the patched context, not just the original.
        expect(patch.contextId).toBe('agent:writer');
        expect(patched[0]?.content).toContain('patch text');
        return { pass: true, evidenceRefs: [] };
      },
    };

    const result = await new Evolution({
      contexts: contextStore(),
      trajectory: failingTrajectory(),
      judger,
      runner,
      decide: () => 'approved',
      applier: (context, _patch) => ({
        ...context,
        content: 'patch text applied',
      }),
    }).run();

    // One patch proposed for the culprit, validated, and approved.
    expect(result.verdicts).toHaveLength(1);
    expect(result.verdicts[0]?.pass).toBe(true);
    expect(result.approved).toHaveLength(1);
    expect(result.approved[0]?.patch.contextId).toBe('agent:writer');
    expect(seen).toContain('agent:writer');
  });

  it('derives the context graph from the trajectory (dependents = blast radius)', async () => {
    const runner: RunRunner = {
      run: () => ({ pass: true, evidenceRefs: [] }),
    };
    const result = await new Evolution({
      contexts: contextStore(),
      trajectory: failingTrajectory(),
      judger,
      runner,
      decide: () => 'approved',
    }).run();

    // agent:editor used agent:writer (edge from→to = from depends on to),
    // so it lands in the patch's affected set — the re-validate blast
    // radius, derived from the trajectory's contextEdges alone.
    expect(result.approved[0]?.patch.affected).toContain('agent:editor');
  });

  it('rejects everything when no human gate is provided (default)', async () => {
    const result = await new Evolution({
      contexts: contextStore(),
      trajectory: failingTrajectory(),
      judger,
      runner: passRunner,
    }).run();

    expect(result.approved).toHaveLength(0);
  });

  it('a mentioned source directory excludes everything under it', async () => {
    const trajectory = failingTrajectory();
    const sourceJudger: Judger = {
      distill: (_run: Run) => [
        {
          kind: 'failure',
          polarity: 'negative',
          content: 'the earth is flat',
          culprit: {
            role: 'introducer',
            kind: 'agent',
            ref: 'src/tools/nested/deep/grep.ts',
          },
        },
      ],
    };
    const result = await new Evolution({
      contexts: contextStore(),
      trajectory,
      judger: sourceJudger,
      runner: passRunner,
      decide: () => 'approved',
      sourcePaths: ['src'],
    }).run();

    expect(result.verdicts).toHaveLength(0);
  });

  it('maintain() judges each run exactly once (offline: wiki kept current)', async () => {
    let judged = 0;
    const countingJudger: Judger = {
      distill: async (run: Run) => {
        judged += 1;
        return judger.distill(run);
      },
    };
    const trajectory = failingTrajectory();
    const evolution = new Evolution({
      contexts: contextStore(),
      trajectory,
      judger: countingJudger,
      runner: passRunner,
    });

    await evolution.maintain();
    await evolution.maintain(); // no new runs → no new judging
    expect(judged).toBe(1);

    // A second run lands: only it gets judged.
    const [firstRun] = trajectory.runs();
    trajectory.onTask({
      ...firstRun,
      id: 'task:run-2',
      contextsUsed: [],
      contextEdges: [],
    });
    await evolution.maintain();
    expect(judged).toBe(2);
  });

  it('run() is re-entrant: an earlier pass never re-proposes its culprit', async () => {
    const evolution = new Evolution({
      contexts: contextStore(),
      trajectory: failingTrajectory(),
      judger,
      runner: passRunner,
      decide: () => 'approved',
    });

    const first = await evolution.run();
    expect(first.verdicts).toHaveLength(1);
    expect(first.approved).toHaveLength(1);

    const second = await evolution.run();
    expect(second.verdicts).toHaveLength(0);
    expect(second.approved).toHaveLength(0);
  });

  it('realtime: continuation runs re-sync contexts and evolve new culprits', async () => {
    const seenContent: string[] = [];
    const runner: RunRunner = {
      run: (_original, patched) => {
        seenContent.push(patched[0]?.content ?? '');
        return { pass: true, evidenceRefs: [] };
      },
    };
    // Judges by grounded fact: a "flat again" failure blames agent:editor,
    // the original "flat" failure blames agent:writer.
    const factJudger: Judger = {
      distill: (run: Run): DistilledEntry[] => {
        const texts = run.records.map((r) => r.content);
        if (texts.some((c) => c.includes('flat again')))
          return [
            {
              kind: 'failure',
              polarity: 'negative',
              content: 'the earth is flat again',
              culprit: {
                role: 'introducer',
                kind: 'agent',
                ref: 'agent:editor',
              },
            },
          ];
        return judger.distill(run);
      },
    };
    const trajectory = failingTrajectory();
    // One instance for the whole lifecycle.
    const evolution = new Evolution({
      contexts: contextStore(),
      trajectory,
      judger: factJudger,
      runner,
      decide: () => 'approved',
    });

    // Pass 1 mid-task: the culprit context is patched and approved.
    const first = await evolution.run();
    expect(first.approved[0]?.patch.contextId).toBe('agent:writer');
    expect(seenContent[0]).toContain('You are a careful writer.');

    // The client applies the patch and the task continues with a new failing
    // run that renders agent:editor.
    const continuation: TaskEvent = {
      id: 'task:run-2',
      kind: 'agent_run',
      producer: 'root',
      contextsUsed: [
        { contextId: 'agent:editor', version: '0', recordRef: 'rec:editor2' },
      ],
      contextEdges: [],
      inputRefs: [],
      outputRefs: [],
      status: 'failed',
    };
    trajectory.onTask(continuation);
    trajectory.record({
      id: 'rec:editor2',
      taskId: continuation.id,
      role: 'context_injection',
      content: 'You are a careful editor.',
      contextId: 'agent:editor',
    });
    trajectory.record({
      id: 'rec:bad2',
      taskId: continuation.id,
      role: 'assistant',
      content: 'the earth is flat again',
    });

    // Pass 2 on the same instance: only agent:editor is proposed (writer
    // already had its pass), and the forked run sees the editor's synced
    // context content.
    const second = await evolution.run();
    expect(second.verdicts).toHaveLength(1);
    expect(second.verdicts[0]?.patch.contextId).toBe('agent:editor');
    expect(seenContent[1]).toContain('You are a careful editor.');
  });

  it('writes gate-approved patches to the context store', async () => {
    const contexts = contextStore();
    const result = await new Evolution({
      contexts,
      trajectory: failingTrajectory(),
      judger,
      runner: passRunner,
      decide: () => 'approved',
      applier: (context, patch) => ({
        ...context,
        content: `${context.content} [patched: ${patch.patch}]`,
      }),
    }).run();

    expect(result.approved).toHaveLength(1);
    // The store is the write path: the approved patch landed in it.
    expect(contexts.get('agent:writer')?.content).toContain('[patched:');
    // Other contexts untouched.
    expect(contexts.get('skill:review')?.content).toBe('Review every claim.');
  });

  it('judges through the framework-owned prompt when only a model is given', async () => {
    const contexts = contextStore();
    const result = await new Evolution({
      contexts,
      trajectory: failingTrajectory(),
      model: {
        complete: async () =>
          JSON.stringify([
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
          ]),
      },
      runner: passRunner,
      decide: () => 'approved',
    }).run();

    // No client judger — the framework prompt produced the judgment, and
    // the approved patch was written to the store.
    expect(result.verdicts).toHaveLength(1);
    expect(contexts.get('agent:writer')?.content).toContain(
      'You are a careful writer.',
    );
    expect(result.approved).toHaveLength(1);
  });

  it('rejects construction without a model call or judger override', () => {
    expect(
      () =>
        new Evolution({
          contexts: contextStore(),
          trajectory: failingTrajectory(),
          runner: passRunner,
        } as never),
    ).toThrow(/model call or a judger/);
  });

  it('never proposes for a context the store does not own', async () => {
    const ghostJudger: Judger = {
      distill: (_run: Run) => [
        {
          kind: 'failure',
          polarity: 'negative',
          content: 'the earth is flat',
          culprit: { role: 'introducer', kind: 'agent', ref: 'agent:ghost' },
        },
      ],
    };
    const contexts = contextStore(); // no agent:ghost in the store
    const result = await new Evolution({
      contexts,
      trajectory: failingTrajectory(),
      judger: ghostJudger,
      runner: passRunner,
      decide: () => 'approved',
    }).run();

    expect(result.verdicts).toHaveLength(0);
    expect(result.approved).toHaveLength(0);
    expect(contexts.get('agent:writer')?.content).toBe(
      'You are a careful writer.',
    );
  });
});
