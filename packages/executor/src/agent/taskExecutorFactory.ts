import { TaskExecutor } from '../agent/agent.ts';
import type { AgentDefinition } from '../agent/agents.ts';
import type { AgentSessionRepository } from '../durable/index.ts';
import type { SpawnInput, SpawnResult } from '../durable/spawn-tool.ts';
import type { MissionUi } from '../types.ts';

export interface TaskExecutorCreateContext {
  task: string;
  agentId: string;
  depth: number;
}

export interface TaskExecutorFactory {
  create(context: TaskExecutorCreateContext): TaskExecutor;
}

export interface DefaultTaskExecutorFactoryOptions {
  ui: MissionUi;
  cwd?: string;
  agentDefs: AgentDefinition[];
  repository: AgentSessionRepository;
  maxSpawnDepth: number;
}

export class DefaultTaskExecutorFactory implements TaskExecutorFactory {
  private readonly agentDefs: AgentDefinition[];
  private readonly maxSpawnDepth: number;
  private readonly repository: AgentSessionRepository;
  private readonly cwd?: string;
  private readonly ui: MissionUi;

  constructor(options: DefaultTaskExecutorFactoryOptions) {
    this.agentDefs = options.agentDefs;
    this.maxSpawnDepth = options.maxSpawnDepth;
    this.repository = options.repository;
    this.cwd = options.cwd;
    this.ui = options.ui;
  }

  create(context: TaskExecutorCreateContext): TaskExecutor {
    if (context.depth >= this.maxSpawnDepth) {
      throw new Error(
        `spawn_agent refused: nesting depth limit (${this.maxSpawnDepth}) reached. Complete the task yourself.`,
      );
    }

    const definition = this.agentDefs.find((d) => d.id === context.agentId);

    if (!definition) {
      const available = this.agentDefs.map((d) => d.id).join(', ') || 'none';
      throw new Error(
        `Unknown agent id "${context.agentId}". Available definitions: ${available}.`,
      );
    }

    const child = new TaskExecutor({
      agentId: context.agentId,
      task: context.task,
      definition,
      depth: context.depth,
      maxSpawnDepth: this.maxSpawnDepth,
      cwd: this.cwd,
      repository: this.repository,
      ui: this.ui,
      // A leaf (one below the depth limit) can never spawn a child, so it
      // must not even see the tool — nor the subagent roster it would use.
      ...(context.depth < this.maxSpawnDepth - 1
        ? {
            spawn: (input: SpawnInput) => this.spawn(input),
            subagents: this.subagentsOf(definition),
          }
        : {}),
    });

    return child;
  }

  /**
   * Definitions the given agent may spawn — mirrors spawn()'s allowlist
   * policy exactly: declared edges → those targets; no edges → every other
   * loaded agent.
   */
  private subagentsOf(definition: AgentDefinition): AgentDefinition[] {
    const targets = definition.edges.map((edge) => edge.target);
    return this.agentDefs.filter(
      (d) =>
        d.id !== definition.id &&
        (targets.length === 0 || targets.includes(d.id)),
    );
  }

  /**
   * Spawn a child agent: validate the parent's edge allowlist, create the
   * child through `create()` (which owns depth + unknown-agent guards), run
   * it, and return its final text plus its trajectory. This is the
   * `spawn_agent` tool's handler.
   */
  async spawn(input: SpawnInput): Promise<SpawnResult | undefined> {
    const parent = this.agentDefs.find((d) => d.id === input.parentAgentId);
    const allowed = parent?.edges.map((edge) => edge.target) ?? [];

    if (allowed.length > 0 && !allowed.includes(input.agent)) {
      throw new Error(
        `spawn_agent refused: "${input.parentAgentId}" may only spawn ` +
          `[${allowed.join(', ')}] (its declared edges), not "${input.agent}".`,
      );
    }

    const child = this.create({
      task: input.task,
      agentId: input.agent,
      depth: input.parentDepth + 1,
    });

    try {
      const result = await child.run();
      return {
        text: result.text || '(no output)',
        trajectory: result.trajectory,
      };
    } catch (err) {
      const e = err as Error;
      throw new Error(`Agent ${child.agentId} failed: ${e.name}: ${e.message}`);
    }
  }
}
