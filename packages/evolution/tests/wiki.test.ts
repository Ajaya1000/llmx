import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DefaultPinpointer } from '../src/pinpoint.ts';
import { InMemoryContextRegistry } from '../src/store/context-registry.ts';
import { DefaultWikiMaintainer } from '../src/store/wiki.ts';
import {
  InMemoryWikiPersistence,
  SqliteWikiPersistence,
} from '../src/store/wiki-persistence.ts';
import type { Trajectory } from '../src/trajectory.ts';
import type { WikiRow } from '../src/wiki-types.ts';

function row(partial: Partial<WikiRow> & { id: string }): WikiRow {
  return {
    runId: 'run-1',
    kind: 'failure',
    author: { kind: 'agent', agentId: 'run-1' },
    refs: {},
    content: '',
    useCount: 0,
    lastUsedAt: 0,
    createdAt: 0,
    ...partial,
  };
}

/** An empty run — nothing to pinpoint. */
function pinpointer(): DefaultPinpointer {
  const trajectory: Trajectory = {
    agentId: 'none',
    task: '',
    depth: 0,
    context: { tools: [] },
    steps: [],
  };
  return new DefaultPinpointer(trajectory, new InMemoryContextRegistry());
}

describe('DefaultWikiMaintainer', () => {
  it('records, exposes every row, and re-loads through persistence', () => {
    const persistence = new InMemoryWikiPersistence();
    const wiki = new DefaultWikiMaintainer(pinpointer(), persistence);

    wiki.record(row({ id: 'r1', kind: 'strategy', content: 'do X' }));
    wiki.record(row({ id: 'r2', kind: 'failure', lastUsedAt: 0 }));
    wiki.record(row({ id: 'r3', kind: 'failure', lastUsedAt: Date.now() }));

    // every held row — the prior knowledge the wiki agent searches across
    expect(wiki.rows().map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
    // failures only, retention-ranked (r3 most recently used → first)
    expect(wiki.prioritizedFailures().map((r) => r.id)).toEqual(['r3', 'r2']);

    const reloaded = new DefaultWikiMaintainer(pinpointer(), persistence);
    expect(reloaded.prioritizedFailures().map((r) => r.id)).toEqual([
      'r3',
      'r2',
    ]);
  });

  it('pinpoint delegates to the pinpointer over the run trajectory', () => {
    const trajectory: Trajectory = {
      agentId: 'agent-a',
      task: 't',
      depth: 0,
      context: { tools: [] },
      steps: [{ type: 'text', text: 'the fact X appears here' }],
    };
    const wiki = new DefaultWikiMaintainer(
      new DefaultPinpointer(trajectory, new InMemoryContextRegistry()),
      new InMemoryWikiPersistence(),
    );
    expect(wiki.pinpoint('X')?.culprit).toBe('agent-a');
  });

  it('sqlite persistence round-trips and evicts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'llmx-wiki-'));
    try {
      const persistence = new SqliteWikiPersistence(join(dir, 'wiki.sqlite'));
      persistence.save(row({ id: 'r1', content: 'x' }));
      expect(persistence.load().map((r) => r.id)).toEqual(['r1']);
      persistence.evict((r) => r.id === 'r1');
      expect(persistence.load()).toEqual([]);
      persistence.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
