import { describe, expect, it } from 'vitest';
import { DefaultRetentionPolicy } from '../src/store/retention.ts';
import type { WikiRow } from '../src/wiki-types.ts';

function row(partial: Partial<WikiRow> & { id: string }): WikiRow {
  return {
    runId: 'm1',
    kind: 'failure',
    author: { kind: 'agent', agentId: 't1' },
    refs: {},
    content: '',
    useCount: 0,
    lastUsedAt: 0,
    createdAt: 0,
    ...partial,
  };
}

function culpritX(): WikiRow['culprit'] {
  return { role: 'introducer', kind: 'tool', ref: 'X' };
}

describe('DefaultRetentionPolicy', () => {
  it('evicts only stale-and-cold rows', () => {
    const policy = new DefaultRetentionPolicy({
      staleAfterMs: 1000,
      minUses: 2,
    });
    const now = 10_000;
    const rows = [
      row({ id: 'keep-recent', lastUsedAt: now - 500, useCount: 0 }),
      row({ id: 'evict-old-cold', lastUsedAt: now - 2000, useCount: 0 }),
      row({ id: 'keep-old-hot', lastUsedAt: now - 2000, useCount: 5 }),
      row({ id: 'keep-recent-cold', lastUsedAt: now - 500, useCount: 1 }),
    ];
    expect(policy.evict(rows, now)).toEqual(['evict-old-cold']);
  });

  it('topK ranks by recency × frequency × convergence', () => {
    const policy = new DefaultRetentionPolicy();
    const now = 10_000;
    const rows = [
      // convergent culprit (2 rows blame X) and frequent → wins
      row({ id: 'a', culprit: culpritX(), lastUsedAt: now, useCount: 10 }),
      row({ id: 'b', culprit: culpritX(), lastUsedAt: now, useCount: 0 }),
      // same frequency as 'a' but culprit Y blamed once → loses
      row({
        id: 'd',
        culprit: { role: 'introducer', kind: 'tool', ref: 'Y' },
        lastUsedAt: now,
        useCount: 10,
      }),
    ];
    expect(policy.topK(rows, 1, now).map((r) => r.id)).toEqual(['a']);
  });
});
