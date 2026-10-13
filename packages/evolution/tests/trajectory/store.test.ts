import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Trajectory } from '../../src/trajectory/index.js';
import { TrajectoryStore } from '../../src/trajectory/store.js';

const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tmpDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tmpDirs.length = 0;
});

async function workdir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'trajectory-store-'));
  tmpDirs.push(dir);
  return dir;
}

function trajectory(): Trajectory {
  return {
    flow: 'fix the bug',
    definition: [{ id: 'user-1', type: 'user' }],
    traces: [{ itemRef: 'user-1', message: 'go' }],
  };
}

describe('TrajectoryStore', () => {
  it('round-trips a rendered trajectory through read()', async () => {
    const path = await workdir();
    const original = trajectory();

    await expect(
      new TrajectoryStore(original).createWorkingDirectory(path),
    ).resolves.toBe(join(path, 'trajectory'));

    const loaded = await TrajectoryStore.read(path);
    expect(loaded.directory).toBe(join(path, 'trajectory'));
    expect(loaded.trajectory).toEqual(original);
  });
});
