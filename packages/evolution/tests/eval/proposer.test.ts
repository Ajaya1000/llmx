import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  AgenticExecutor,
  AgenticRunOutcome,
} from '../../src/agent/index.js';
import type { Context } from '../../src/context/index.js';
import { FileContextStore } from '../../src/context/store.js';
import {
  buildEvalProposerTask,
  evalProposerSystemPrompt,
} from '../../src/eval/prompt.js';
import { EvalProposer } from '../../src/eval/proposer.js';
import { TrajectoryDistiller } from '../../src/trajectory/distiller/index.js';
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
  const dir = await mkdtemp(join(tmpdir(), 'eval-proposer-'));
  tmpDirs.push(dir);
  return dir;
}

function context(): Context {
  return {
    id: 'tool:search',
    type: 'tool',
    name: 'Search',
    description: 'Find things',
    content: '# Search\n',
  };
}

function trajectory(): Trajectory {
  return { flow: 'find the doc', definition: [], traces: [] };
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

describe('EvalProposer', () => {
  it('renders contexts and trajectory, distills, then runs the agent over them', async () => {
    const root = await workdir();
    const storePath = await workdir();
    const store = new FileContextStore([context()], storePath);
    const distiller = new TrajectoryDistiller({
      store: new TrajectoryStore(trajectory()),
      executor: fakeExecutor({ summary: 'distilled' }).executor,
    });

    let runInput:
      | { systemPrompt: string; task: string; cwd: string }
      | undefined;
    const executor: AgenticExecutor = {
      run: async (input) => {
        runInput = input;
        // The rendered inputs must already exist when the agent starts.
        await expect(
          stat(join(root, 'eval-proposer', 'contexts', 'tool%3Asearch.md')),
        ).resolves.toBeTruthy();
        await expect(
          stat(join(root, 'eval-proposer', 'trajectory', 'flow.md')),
        ).resolves.toBeTruthy();
        await expect(
          stat(
            join(
              root,
              'eval-proposer',
              'distilled-trajectory',
              'failures_and_patterns',
            ),
          ),
        ).resolves.toBeTruthy();
        await writeFile(
          join(root, 'eval-proposer', 'evals', 'tool-search.json'),
          JSON.stringify({
            contextId: 'tool:search',
            evals: [{ type: 'ExactMatch' }],
          }),
          'utf8',
        );
        return { summary: 'proposed' };
      },
    };

    const proposer = new EvalProposer({
      contextStore: store,
      trajectoryDistiller: distiller,
      executor,
      path: root,
    });

    await expect(proposer.createWorkingDirectory()).resolves.toBe(
      join(root, 'eval-proposer'),
    );
    const result = await proposer.propose();

    expect(result.summary).toBe('proposed');
    expect(result.outputDirectory).toBe(join(root, 'eval-proposer', 'evals'));
    if (!runInput) throw new Error('proposer executor never ran');
    expect(runInput.systemPrompt).toBe(evalProposerSystemPrompt);
    expect(runInput.cwd).toBe(join(root, 'eval-proposer'));
    expect(runInput.task).toBe(
      buildEvalProposerTask({
        evalDirectory: join(root, 'eval-proposer'),
        evalsDirectory: join(root, 'eval-proposer', 'evals'),
      }),
    );
    const proposed = await readFile(
      join(root, 'eval-proposer', 'evals', 'tool-search.json'),
      'utf8',
    );
    expect(JSON.parse(proposed)).toEqual({
      contextId: 'tool:search',
      evals: [{ type: 'ExactMatch' }],
    });
  });

  it('throws when propose runs before createWorkingDirectory', async () => {
    const store = new FileContextStore([context()], await workdir());
    const proposer = new EvalProposer({
      contextStore: store,
      trajectoryDistiller: new TrajectoryDistiller({
        store: new TrajectoryStore(trajectory()),
        executor: fakeExecutor({ summary: 'distilled' }).executor,
      }),
      executor: fakeExecutor({ summary: 'never runs' }).executor,
    });

    await expect(proposer.propose()).rejects.toThrow(
      /^EvalProposer needs a working directory/,
    );
  });

  it('creates a temp working directory when no path is given', async () => {
    const storePath = await workdir();
    const store = new FileContextStore([context()], storePath);
    const proposer = new EvalProposer({
      contextStore: store,
      trajectoryDistiller: new TrajectoryDistiller({
        store: new TrajectoryStore(trajectory()),
        executor: fakeExecutor({ summary: 'distilled' }).executor,
      }),
      executor: fakeExecutor({ summary: 'proposed' }).executor,
    });

    const directory = await proposer.createWorkingDirectory();

    expect(basename(directory)).toBe('eval-proposer');
    await expect(stat(directory)).resolves.toBeTruthy();
    tmpDirs.push(dirname(directory));
  });
});
