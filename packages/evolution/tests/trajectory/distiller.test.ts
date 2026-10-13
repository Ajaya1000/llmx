import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  AgenticExecutor,
  AgenticRunOutcome,
} from '../../src/agent/index.js';
import { TrajectoryDistiller } from '../../src/trajectory/distiller/index.js';
import {
  buildDistillerTask,
  distillerSystemPrompt,
} from '../../src/trajectory/distiller/prompt.js';
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
  const dir = await mkdtemp(join(tmpdir(), 'distiller-'));
  tmpDirs.push(dir);
  return dir;
}

function trajectory(): Trajectory {
  return { flow: 'fix the bug', definition: [], traces: [] };
}

function fakeExecutor(reply: AgenticRunOutcome): {
  executor: AgenticExecutor;
  seen: () => { systemPrompt: string; task: string; cwd: string };
} {
  let input: { systemPrompt: string; task: string; cwd: string } | undefined;
  const executor: AgenticExecutor = {
    run: async (received) => {
      input = received;
      return reply;
    },
  };
  return {
    executor,
    seen: () => {
      if (!input) throw new Error('executor.run was never called');
      return input;
    },
  };
}

describe('TrajectoryDistiller', () => {
  it('renders the trajectory, creates the output skeleton, and hands the agent prompt, task, and cwd', async () => {
    const path = await workdir();
    const { executor, seen } = fakeExecutor({ summary: 'distilled' });
    const distiller = new TrajectoryDistiller({
      store: new TrajectoryStore(trajectory()),
      executor,
    });

    await expect(distiller.createWorkingDirectory(path)).resolves.toBe(
      join(path, 'trajectory'),
    );
    await expect(
      readFile(join(path, 'trajectory', 'flow.md'), 'utf8'),
    ).resolves.toBe('fix the bug');

    const result = await distiller.distill();

    expect(result.summary).toBe('distilled');
    expect(result.outputDirectory).toBe(join(path, 'distilled-trajectory'));
    for (const dir of [
      result.outputDirectory,
      join(result.outputDirectory, 'failures_and_patterns'),
    ]) {
      await expect(stat(dir)).resolves.toBeTruthy();
    }
    expect(seen().systemPrompt).toBe(distillerSystemPrompt);
    expect(seen().task).toBe(
      buildDistillerTask({
        storeDirectory: join(path, 'trajectory'),
        outputDirectory: join(path, 'distilled-trajectory'),
      }),
    );
    expect(seen().cwd).toBe(path);
  });

  it('throws when distill runs before a working directory exists', async () => {
    const { executor } = fakeExecutor({ summary: 'never runs' });
    await expect(
      new TrajectoryDistiller({
        store: new TrajectoryStore(trajectory()),
        executor,
      }).distill(),
    ).rejects.toThrow(/^TrajectoryDistiller needs a working directory/);
  });

  it('throws when a rendered store file is missing', async () => {
    const path = await workdir();
    const { executor } = fakeExecutor({ summary: 'never runs' });
    const distiller = new TrajectoryDistiller({
      store: new TrajectoryStore(trajectory()),
      executor,
    });

    await distiller.createWorkingDirectory(path);
    await rm(join(path, 'trajectory', 'definition.json'));

    await expect(distiller.distill()).rejects.toThrow(
      /Missing trajectory store file/,
    );
  });

  it('runs the executor-backed default path against a rendered store', async () => {
    const path = await workdir();
    const { executor } = fakeExecutor({ summary: 'distilled' });
    const distiller = new TrajectoryDistiller({
      store: new TrajectoryStore(trajectory()),
      executor,
    });

    await distiller.createWorkingDirectory(path);
    await expect(distiller.distill()).resolves.toMatchObject({
      summary: 'distilled',
      outputDirectory: join(path, 'distilled-trajectory'),
    });
  });
});
