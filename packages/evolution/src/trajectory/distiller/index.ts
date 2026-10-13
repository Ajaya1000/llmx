import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type AgenticExecutor,
  type AgenticRunOutcome,
  MissionAgenticExecutor,
} from '../../agent/index.js';
import type { TrajectoryStore } from '../store.js';
import { buildDistillerTask, distillerSystemPrompt } from './prompt.js';

export interface DistillResult extends AgenticRunOutcome {
  /** The created `distilled-trajectory/` directory. */
  outputDirectory: string;
}

export interface TrajectoryDistillerOptions {
  /** The trajectory store this distiller renders and distills. */
  store: TrajectoryStore;
  /** Agentic executor; defaults to the mission-backed one. */
  executor?: AgenticExecutor;
}

const STORE_FILES = ['flow.md', 'definition.json', 'traces.json'] as const;

/** The coding agent that renders a trajectory store and distills it into `distilled-trajectory/`. */
export class TrajectoryDistiller {
  private readonly store: TrajectoryStore;
  private readonly executor: AgenticExecutor;
  private path?: string;

  constructor(options: TrajectoryDistillerOptions) {
    this.store = options.store;
    this.executor = options.executor ?? this.defaultExecutor();
  }

  /** The trajectory store this distiller reads. */
  get storeDirectory(): string {
    return this.store.directory;
  }

  /** The directory this distiller creates and the agent fills. */
  get outputDirectory(): string {
    return join(this.requirePath(), 'distilled-trajectory');
  }

  /** Writes the store's trajectory as `<path>/trajectory/` and returns that store folder. */
  async createWorkingDirectory(path: string): Promise<string> {
    this.path = path;
    return this.store.createWorkingDirectory(path);
  }

  /** Creates the output skeleton, then runs the distiller agent over the store. */
  async distill(): Promise<DistillResult> {
    const directory = this.requirePath();
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
      cwd: directory,
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

  private requirePath(): string {
    if (!this.path) {
      throw new Error(
        'TrajectoryDistiller needs a working directory: call createWorkingDirectory(path) first',
      );
    }
    return this.path;
  }
}
