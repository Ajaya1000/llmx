import { describe, expect, it } from 'vitest';
import {
  DefaultEvolutionLoop,
  type PatchApplier,
} from '../src/evolution-loop.ts';
import type { WikiPort } from '../src/ports.ts';
import type { PatchProposer } from '../src/proposer.ts';
import { InMemoryContextRegistry } from '../src/store/context-registry.ts';
import { DefaultVerifier, type RunRunner } from '../src/verifier.ts';
import type { ContextPatch, Verdict, WikiRow } from '../src/wiki-types.ts';

const failure: WikiRow = {
  id: 'f1',
  runId: 'm1',
  kind: 'failure',
  author: { kind: 'agent', agentId: 't1' },
  refs: {},
  content: 'wrong output',
  culprit: { role: 'introducer', kind: 'tool', ref: 'tool-a' },
  useCount: 0,
  lastUsedAt: 0,
  createdAt: 0,
};

const draft: ContextPatch = {
  contextId: 'tool-a',
  contextKind: 'tool',
  patch: 'draft',
};

function wiki(): WikiPort {
  return {
    record: () => {},
    pinpoint: () => null,
    prioritizedFailures: () => [failure],
  };
}

function proposer(
  revise: (patch: ContextPatch, verdict: Verdict) => ContextPatch | null,
): PatchProposer {
  return {
    propose: () => [draft],
    revise,
  };
}

function runner(passes: (patch: ContextPatch) => boolean): RunRunner {
  return {
    run: (_original, _patched, patch) => ({
      pass: passes(patch),
      evidenceRefs: ['e1'],
    }),
  };
}

function registry(): InMemoryContextRegistry {
  const r = new InMemoryContextRegistry();
  r.register({ id: 'tool-a', kind: 'tool', content: 'old', dependsOn: [] });
  return r;
}

const loop = (
  proposerImpl: PatchProposer,
  runnerImpl: RunRunner,
  maxRetries?: number,
  applier?: PatchApplier,
): DefaultEvolutionLoop =>
  new DefaultEvolutionLoop(
    wiki(),
    proposerImpl,
    new DefaultVerifier(runnerImpl, maxRetries),
    registry(),
    applier,
  );

describe('DefaultEvolutionLoop', () => {
  it('records a pass without retrying', () => {
    const result = loop(
      proposer(() => null),
      runner(() => true),
    ).run();

    expect(result.retriesUsed).toBe(0);
    expect(result.verdicts).toHaveLength(1);
    expect(result.verdicts[0].pass).toBe(true);
  });

  it('feeds a failure back to the proposer and succeeds on a retry', () => {
    const fixed: ContextPatch = { ...draft, patch: 'fixed' };
    const result = loop(
      proposer(() => fixed),
      runner((patch) => patch.patch === 'fixed'),
    ).run();

    expect(result.retriesUsed).toBe(1);
    expect(result.verdicts[0].pass).toBe(true);
    expect(result.verdicts[0].patch).toEqual(fixed);
  });

  it('gives up when the proposer cannot revise', () => {
    const result = loop(
      proposer(() => null),
      runner(() => false),
    ).run();

    expect(result.retriesUsed).toBe(0);
    expect(result.verdicts[0].pass).toBe(false);
  });

  it('stops at the retry bound', () => {
    const result = loop(
      proposer((patch) => ({ ...patch, patch: `${patch.patch}x` })),
      runner(() => false),
      2,
    ).run();

    expect(result.retriesUsed).toBe(2);
    expect(result.verdicts[0].pass).toBe(false);
  });
});
