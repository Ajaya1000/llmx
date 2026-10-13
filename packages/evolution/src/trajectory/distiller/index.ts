import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type AgenticExecutor,
  type AgenticRunOutcome,
  MissionAgenticExecutor,
} from '../../agent/index.js';
import { buildDistillerTask, distillerSystemPrompt } from './prompt.js';

export interface DistillResult extends AgenticRunOutcome {
  /** The created `distilled-trajectory/` directory. */
  outputDirectory: string;
}

export interface TrajectoryDistillerOptions {
  /** Location holding the `trajectory/` store; `distilled-trajectory/` is created beside it. */
  path: string;
  /** Agentic executor; defaults to the mission-backed one. */
  executor?: AgenticExecutor;
}

const STORE_FILES = ['flow.md', 'definition.json', 'traces.json'] as const;

/** The coding agent that distills a trajectory store into `distilled-trajectory/`. */
export class TrajectoryDistiller {
  private readonly path: string;
  private readonly executor: AgenticExecutor;

  constructor(options: TrajectoryDistillerOptions) {
    this.path = options.path;
    this.executor = options.executor ?? this.defaultExecutor();
  }

  /** The trajectory store this distiller reads. */
  get storeDirectory(): string {
    return join(this.path, 'trajectory');
  }

  /** The directory this distiller creates and the agent fills. */
  get outputDirectory(): string {
    return join(this.path, 'distilled-trajectory');
  }

  /** Creates the output skeleton, then runs the distiller agent over the store. */
  async distill(): Promise<DistillResult> {
    await this.assertStore();
    await mkdir(join(this.outputDirectory, 'failures_and_patterns'), {
      recursive: true,
    });
    const outcome = await this.executor.run({
      systemPrompt: distillerSystemPrompt,
      task: buildDistillerTask({
        storeDirectory: this.storeDirectory,
        outputDirectory: this.outputDirectory,
      }),
      cwd: this.path,
    });
    return { ...outcome, outputDirectory: this.outputDirectory };
  }

  /** Plain profile: the run's system prompt becomes the agent's procedure. */
  private defaultExecutor(): AgenticExecutor {
    return new MissionAgenticExecutor({
      id: 'trajectory-distiller',
      title: 'Trajectory Distiller',
      description:
        'Distills one recorded trajectory into distilled-trajectory/.',
      goal: 'Distill the recorded trajectory.',
    });
  }

  /** The store must be complete before the agent can read it. */
  private async assertStore(): Promise<void> {
    for (const file of STORE_FILES) {
      const filePath = join(this.storeDirectory, file);
      const exists = await stat(filePath).then(
        () => true,
        () => false,
      );
      if (!exists) {
        throw new Error(`Missing trajectory store file: ${filePath}`);
      }
    }
  }
}
