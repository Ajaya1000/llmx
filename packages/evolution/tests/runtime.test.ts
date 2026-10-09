import { describe, expect, it } from 'vitest';
import { Evolution } from '../src/runtime.ts';
import { InMemoryContextStore } from '../src/store/context-store.ts';
import { InMemoryWikiPersistence } from '../src/store/wiki-persistence.ts';
import type { Trajectory } from '../src/trajectory.ts';
import type {
  DistilledEntry,
  DistilledRun,
  Judger,
} from '../src/trajectory-distiller.ts';
import type { Ref } from '../src/types.ts';
import type { RunRunner } from '../src/verifier.ts';
import type { WikiAgent } from '../src/wiki-distiller.ts';

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

/** One recorded run: the writer agent produced a wrong fact. */
function writerRun(fact = 'the earth is flat'): Trajectory {
  return {
    agentId: 'agent:writer',
    task: 'write the report',
    depth: 0,
    context: { instructions: 'You are a careful writer.', tools: [] },
    steps: [
      { role: 'system', content: 'You are a careful writer.' },
      { role: 'user', content: 'write it' },
      { type: 'text', text: fact },
    ],
  };
}

/** One recorded run: the editor agent produced a wrong fact (continuation). */
function editorRun(): Trajectory {
  return {
    agentId: 'agent:editor',
    task: 'edit the report',
    depth: 0,
    context: { instructions: 'You are a careful editor.', tools: [] },
    steps: [
      { role: 'system', content: 'You are a careful editor.' },
      { role: 'user', content: 'edit it' },
      { type: 'text', text: 'the earth is flat again' },
    ],
  };
}

/** Observes the run view as one failure blamed on the run's own agent. */
function judger(culprit: Ref): Judger {
  return {
    distill: async (view) => [
      {
        kind: 'failure',
        polarity: 'negative',
        content:
          view.steps.map((s) => s.text).find((t) => t.includes('flat')) ??
          'the earth is flat',
        culprit: { role: 'introducer', kind: 'agent', ref: culprit },
      } satisfies DistilledEntry,
    ],
  };
}

/** The wiki agent: restructures each response's entries into rows. */
const wikiAgent: WikiAgent = {
  distill: async (responses) => {
    const now = Date.now();
    return responses.flatMap((response: DistilledRun) =>
      response.entries.map((entry, i) => ({
        id: `${response.view.runId}:${i}`,
        runId: response.view.runId,
        kind: entry.kind,
        polarity: entry.polarity,
        author: { kind: 'agent', agentId: response.view.runId },
        refs: { stepRef: entry.stepRef },
        culprit: entry.culprit,
        content: entry.content,
        useCount: 0,
        lastUsedAt: now,
        createdAt: now,
      })),
    );
  },
};

const passRunner: RunRunner = {
  run: () => ({ pass: true, evidenceRefs: [] }),
};

describe('Evolution (composition root)', () => {
  it('never proposes a patch for mentioned source code paths', async () => {
    const result = await new Evolution({
      contexts: contextStore(),
      trajectory: writerRun(),
      judger: judger('src/tools/grep.ts'),
      wikiAgent,
      runner: passRunner,
      decide: () => 'approved',
      sourcePaths: ['src/tools'],
    }).run();

    // The failure is kept as wiki knowledge, but nothing is proposed,
    // validated, or approved for source code.
    expect(result.verdicts).toHaveLength(0);
    expect(result.approved).toHaveLength(0);
  });

  it('a mentioned source directory excludes everything under it', async () => {
    const result = await new Evolution({
      contexts: contextStore(),
      trajectory: writerRun(),
      judger: judger('src/tools/nested/deep/grep.ts'),
      wikiAgent,
      runner: passRunner,
      decide: () => 'approved',
      sourcePaths: ['src'],
    }).run();

    expect(result.verdicts).toHaveLength(0);
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
      trajectory: writerRun(),
      judger: judger('agent:writer'),
      wikiAgent,
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

  it('derives the context graph from the store (dependents = blast radius)', async () => {
    const result = await new Evolution({
      contexts: contextStore(),
      trajectory: writerRun(),
      judger: judger('agent:writer'),
      wikiAgent,
      runner: passRunner,
      decide: () => 'approved',
    }).run();

    // agent:editor depends on agent:writer (store definition), so it lands
    // in the patch's affected set — the re-validate blast radius.
    expect(result.approved[0]?.patch.affected).toContain('agent:editor');
  });

  it('rejects everything when no human gate is provided (default)', async () => {
    const result = await new Evolution({
      contexts: contextStore(),
      trajectory: writerRun(),
      judger: judger('agent:writer'),
      wikiAgent,
      runner: passRunner,
    }).run();

    expect(result.approved).toHaveLength(0);
  });

  it('maintain() distills the run exactly once (idempotent)', async () => {
    let observed = 0;
    const countingJudger: Judger = {
      distill: async (view) => {
        observed += 1;
        return judger('agent:writer').distill(view);
      },
    };
    const evolution = new Evolution({
      contexts: contextStore(),
      trajectory: writerRun(),
      judger: countingJudger,
      wikiAgent,
      runner: passRunner,
    });

    await evolution.maintain();
    await evolution.maintain(); // no-op: the run is already distilled
    expect(observed).toBe(1);
  });

  it('two failures on one context each keep their own eval pass', async () => {
    // The judger reports two distinct failures, both blamed on agent:writer.
    const twoFailures: Judger = {
      distill: async (view) =>
        ['the earth is flat', 'the moon is cheese'].map(
          (content) =>
            ({
              kind: 'failure',
              polarity: 'negative',
              content,
              culprit: {
                role: 'introducer',
                kind: 'agent',
                ref: 'agent:writer',
              },
            }) satisfies DistilledEntry,
        ),
    };
    const evolution = new Evolution({
      contexts: contextStore(),
      trajectory: writerRun(),
      judger: twoFailures,
      wikiAgent,
      runner: passRunner,
      decide: () => 'approved',
    });

    // Pass 1: both failures derive their evals, but the proposer emits one
    // patch per context per pass — one verdict.
    const first = await evolution.run();
    expect(first.verdicts).toHaveLength(1);

    // Pass 2: the second failure still hasn't had its pass — it gets its
    // own proposal for the same context (its own eval set behind it).
    const second = await evolution.run();
    expect(second.verdicts).toHaveLength(1);
    expect(second.verdicts[0]?.patch.contextId).toBe('agent:writer');

    // Pass 3: both failures had their pass — nothing left to propose.
    const third = await evolution.run();
    expect(third.verdicts).toHaveLength(0);
  });

  it('run() is re-entrant: an earlier pass never re-proposes its culprit', async () => {
    const evolution = new Evolution({
      contexts: contextStore(),
      trajectory: writerRun(),
      judger: judger('agent:writer'),
      wikiAgent,
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

  it('realtime: a continuation run evolves its own culprit over a shared wiki', async () => {
    const seenContent: string[] = [];
    const runner: RunRunner = {
      run: (_original, patched) => {
        seenContent.push(patched[0]?.content ?? '');
        return { pass: true, evidenceRefs: [] };
      },
    };
    // One wiki (persistence) across both runs — two instances, one per run.
    const persistence = new InMemoryWikiPersistence();

    // Pass 1: the writer's run — its culprit is patched and approved.
    const first = await new Evolution({
      contexts: contextStore(),
      trajectory: writerRun(),
      judger: judger('agent:writer'),
      wikiAgent,
      runner,
      decide: () => 'approved',
      persistence,
    }).run();
    expect(first.approved[0]?.patch.contextId).toBe('agent:writer');
    expect(seenContent[0]).toContain('You are a careful writer.');

    // Pass 2: the client applied the patch; the task continued with a new
    // failing run by the editor. The shared wiki already holds the writer
    // failure; the editor's culprit gets its own pass.
    const second = await new Evolution({
      contexts: contextStore(),
      trajectory: editorRun(),
      judger: judger('agent:editor'),
      wikiAgent,
      runner,
      decide: () => 'approved',
      persistence,
    }).run();
    expect(second.approved.map((a) => a.patch.contextId)).toContain(
      'agent:editor',
    );
    // the forked validation saw the editor's synced context content
    expect(
      seenContent.some((c) => c.includes('You are a careful editor.')),
    ).toBe(true);
  });

  it('writes gate-approved patches to the context store', async () => {
    const contexts = contextStore();
    const result = await new Evolution({
      contexts,
      trajectory: writerRun(),
      judger: judger('agent:writer'),
      wikiAgent,
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

  it('judges and wikifies through the framework prompts when only a model is given', async () => {
    const contexts = contextStore();
    const model = {
      complete: async (prompt: string) =>
        prompt.includes('wiki agent')
          ? // the wiki agent's structured rows
            JSON.stringify([
              {
                kind: 'failure',
                polarity: 'negative',
                content: 'the earth is flat',
                runId: 'agent:writer',
                culprit: {
                  role: 'introducer',
                  kind: 'agent',
                  ref: 'agent:writer',
                },
              },
            ])
          : // the judger's observations
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
    };

    const result = await new Evolution({
      contexts,
      trajectory: writerRun(),
      model,
      runner: passRunner,
      decide: () => 'approved',
    }).run();

    // No client overrides — the framework prompts produced the observation,
    // the wiki agent structured it into a row, and the patch was written.
    expect(result.verdicts).toHaveLength(1);
    expect(result.approved).toHaveLength(1);
    expect(contexts.get('agent:writer')?.content).toContain(
      'You are a careful writer.',
    );
  });

  it('rejects construction without a model call or both overrides', () => {
    expect(
      () =>
        new Evolution({
          contexts: contextStore(),
          trajectory: writerRun(),
          judger: judger('agent:writer'),
          runner: passRunner,
        } as never),
    ).toThrow(/model call or both/);
  });

  it('never proposes for a context the store does not own', async () => {
    const contexts = contextStore(); // no agent:ghost in the store
    const result = await new Evolution({
      contexts,
      trajectory: writerRun(),
      judger: judger('agent:ghost'),
      wikiAgent,
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
