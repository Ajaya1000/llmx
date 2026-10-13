import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AgenticExecutor,
  type AgenticRunOutcome,
  MissionAgenticExecutor,
} from '../agent/index.js';
import type { ContextStore } from '../context/index.js';
import type { TrajectoryDistiller } from '../trajectory/distiller/index.js';
import { buildEvalProposerTask, evalProposerSystemPrompt } from './prompt.js';

export interface EvalProposerResult extends AgenticRunOutcome {
  /** The created `evals/` directory. */
  outputDirectory: string;
}

export interface EvalProposerOptions {
  /** The context store to render; it supplies the artifacts under evaluation. */
  contextStore: ContextStore;
  /** The distiller to render and run; it supplies the failures and patterns. */
  trajectoryDistiller: TrajectoryDistiller;
  /** Agentic executor; defaults to the mission-backed one. */
  executor?: AgenticExecutor;
  /** Parent of the created `eval-proposer/` folder; defaults to a fresh temp dir. */
  path?: string;
}

/** The coding agent that proposes AutoEvals cases from the rendered contexts + distilled trajectory. */
export class EvalProposer {
  private readonly contextStore: ContextStore;
  private readonly distiller: TrajectoryDistiller;
  private readonly executor: AgenticExecutor;
  private readonly root?: string;
  private directory?: string;

  constructor(options: EvalProposerOptions) {
    this.contextStore = options.contextStore;
    this.distiller = options.trajectoryDistiller;
    this.executor = options.executor ?? this.defaultExecutor();
    this.root = options.path;
  }

  /** The `evals/` folder the agent fills. */
  get outputDirectory(): string {
    return join(this.requireDirectory(), 'evals');
  }

  /** Creates `eval-proposer/` and renders both inputs inside it; returns its path. */
  async createWorkingDirectory(): Promise<string> {
    const directory = join(
      this.root ?? (await mkdtemp(join(tmpdir(), 'eval-proposer-'))),
      'eval-proposer',
    );
    await mkdir(directory, { recursive: true });
    this.directory = directory;
    await this.contextStore.createWorkingDirectory(directory);
    await this.distiller.createWorkingDirectory(directory);
    return directory;
  }

  /** Requires the working directory, distills the trajectory, then runs the proposer agent. */
  async propose(): Promise<EvalProposerResult> {
    const directory = this.requireDirectory();
    await this.distiller.distill();
    await mkdir(this.outputDirectory, { recursive: true });
    const outcome = await this.executor.run({
      systemPrompt: evalProposerSystemPrompt,
      task: buildEvalProposerTask({
        evalDirectory: directory,
        evalsDirectory: this.outputDirectory,
      }),
      cwd: directory,
    });
    return { ...outcome, outputDirectory: this.outputDirectory };
  }

  /** Plain profile: the run's system prompt becomes the agent's procedure. */
  private defaultExecutor(): AgenticExecutor {
    return new MissionAgenticExecutor({
      id: 'eval-proposer',
      title: 'Eval Proposer',
      description:
        'Proposes AutoEvals cases for the rendered contexts and distilled trajectory.',
      goal: 'Propose evaluation cases for the implicated contexts.',
    });
  }

  private requireDirectory(): string {
    if (!this.directory) {
      throw new Error(
        'EvalProposer needs a working directory: call createWorkingDirectory() first',
      );
    }
    return this.directory;
  }
}
