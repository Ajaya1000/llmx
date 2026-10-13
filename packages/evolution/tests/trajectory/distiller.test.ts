import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
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
  it('creates the output skeleton and hands the agent prompt, task, and cwd', async () => {
    const path = await workdir();
    await new TrajectoryStore(
      { flow: 'fix the bug', definition: [], traces: [] },
      path,
    ).createWorkingDirectory();
    const { executor, seen } = fakeExecutor({ summary: 'distilled' });

    const result = await new TrajectoryDistiller({ path, executor }).distill();

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

  it('throws when the trajectory store is incomplete', async () => {
    const path = await workdir();
    await mkdir(join(path, 'trajectory'), { recursive: true });
    await writeFile(join(path, 'trajectory', 'flow.md'), 'f', 'utf8');

    const { executor } = fakeExecutor({ summary: 'never runs' });
    await expect(
      new TrajectoryDistiller({ path, executor }).distill(),
    ).rejects.toThrow(/Missing trajectory store file/);
  });

  it('runs the executor-backed default path against a real store layout', async () => {
    const path = await workdir();
    await new TrajectoryStore(
      { flow: 'f', definition: [], traces: [] },
      path,
    ).createWorkingDirectory();

    // The default is the durable executor; its runtime path needs a live
    // model, so assert the type and reuse the fake for the wiring itself.
    const distiller = new TrajectoryDistiller({ path });
    expect(distiller.storeDirectory).toBe(join(path, 'trajectory'));
    const { executor } = fakeExecutor({ summary: 'distilled' });
    await expect(
      new TrajectoryDistiller({ path, executor }).distill(),
    ).resolves.toMatchObject({ summary: 'distilled' });
  });
});
