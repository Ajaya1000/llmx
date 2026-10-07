import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DefaultPinpointer } from '../src/pinpoint.ts';
import { InMemoryContextRegistry } from '../src/store/context-registry.ts';
import { InMemoryTrajectoryStore } from '../src/store/trajectory.ts';
import { DefaultWikiMaintainer } from '../src/store/wiki.ts';
import {
  InMemoryWikiPersistence,
  SqliteWikiPersistence,
} from '../src/store/wiki-persistence.ts';
import type { WikiRow } from '../src/wiki-types.ts';

function row(partial: Partial<WikiRow> & { id: string }): WikiRow {
  return {
    missionId: 'm1',
    kind: 'failure',
    author: { kind: 'task', taskId: 't1' },
    refs: {},
    content: '',
    useCount: 0,
    lastUsedAt: 0,
    createdAt: 0,
    ...partial,
  };
}

function pinpointer(): DefaultPinpointer {
  return new DefaultPinpointer(
    new InMemoryTrajectoryStore(),
    new InMemoryContextRegistry(),
  );
}

describe('DefaultWikiMaintainer', () => {
  it('records and re-loads through the persistence backend', () => {
    const persistence = new InMemoryWikiPersistence();
    const wiki = new DefaultWikiMaintainer(pinpointer(), persistence);

    wiki.record(row({ id: 'r1', kind: 'strategy', content: 'do X' }));
    wiki.record(row({ id: 'r2', kind: 'failure', lastUsedAt: 0 }));
    wiki.record(row({ id: 'r3', kind: 'failure', lastUsedAt: Date.now() }));

    // failures only, retention-ranked (r3 most recently used → first)
    expect(wiki.prioritizedFailures().map((r) => r.id)).toEqual(['r3', 'r2']);

    const reloaded = new DefaultWikiMaintainer(pinpointer(), persistence);
    expect(reloaded.prioritizedFailures().map((r) => r.id)).toEqual([
      'r3',
      'r2',
    ]);
  });

  it('pinpoint delegates to the pinpointer', () => {
    const trajectory = new InMemoryTrajectoryStore();
    trajectory.onTask({
      id: 't1',
      kind: 'agent_run',
      producer: 'agent-a',
      contextsUsed: [],
      contextEdges: [],
      inputRefs: [],
      outputRefs: ['r1'],
      status: 'done',
    });
    trajectory.record({
      id: 'r1',
      taskId: 't1',
      role: 'assistant',
      content: 'the fact X appears here',
    });

    const wiki = new DefaultWikiMaintainer(
      new DefaultPinpointer(trajectory, new InMemoryContextRegistry()),
      new InMemoryWikiPersistence(),
    );
    expect(wiki.pinpoint('X')?.culprit.id).toBe('t1');
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
