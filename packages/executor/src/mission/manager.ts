import type { AgentDefinition } from '../agent/agents.ts';
import { loadAgents } from '../agent/agents.ts';
import { DefaultTaskExecutorFactory } from '../agent/taskExecutorFactory.ts';
import { closeDurableHarness } from '../durable/durable-harness.ts';
import { AgentSessionRepository } from '../durable/index.ts';
import type { Mission, MissionResult, MissionUi } from '../types.ts';
import { LogMissionUi } from './logger.ts';
import { TuiMissionUi } from './tui.ts';

export enum MissionUIType {
  TUI, // terminal UI
  LOG, // normal terminal logs
}
export interface MissionManagerOptions {
  /** Absolute bound on agent nesting. Default: 8. */
  maxSpawnDepth?: number;
  cwd?: string;
  /** Agent definitions children may spawn, handed over directly. */
  agentDefs?: AgentDefinition[];
  /** Agent definitions directory, loaded on run; definitions already in agentDefs win by id. */
  agentsDir?: string;
  uiType: MissionUIType;
  mission: Mission;
}

export class MissionManager {
  private readonly repository: AgentSessionRepository;
  private readonly maxSpawnDepth: number;
  private readonly cwd?: string;
  private readonly agentDefs?: AgentDefinition[];
  private readonly agentsDir?: string;
  private readonly ui: MissionUi;
  private readonly uiType: MissionUIType;
  private readonly mission: Mission;

  constructor(options: MissionManagerOptions) {
    if (options.mission.entry.agent === undefined) {
      throw new Error(
        'mission.entry: agent is required (a roster id or a definition)',
      );
    }
    this.maxSpawnDepth = options.maxSpawnDepth ?? 8;
    this.cwd = options.cwd;
    this.agentDefs = options.agentDefs;
    this.agentsDir = options.agentsDir;
    this.mission = options.mission;
    this.uiType = options.uiType;
    this.ui =
      options.uiType === MissionUIType.TUI
        ? new TuiMissionUi()
        : new LogMissionUi();
    this.repository = new AgentSessionRepository();
  }

  async run(): Promise<MissionResult> {
    if (this.uiType === MissionUIType.TUI && this.ui instanceof TuiMissionUi)
      this.ui.start();

    const roster = await this.mergedRoster();
    const agent = this.mission.entry.agent;
    // An entry definition handed over directly is registered, so the factory's
    // depth + allowlist guards apply to the whole run; a roster id is looked up.
    const agentDefs =
      typeof agent === 'string' || roster.some((d) => d.id === agent.id)
        ? roster
        : [agent, ...roster];

    const taskExecutorFactory = new DefaultTaskExecutorFactory({
      agentDefs,
      repository: this.repository,
      maxSpawnDepth: this.maxSpawnDepth,
      ui: this.ui,
      cwd: this.cwd,
    });

    const taskExecutor = taskExecutorFactory.create({
      task: this.mission.entry.task,
      agentId: typeof agent === 'string' ? agent : agent.id,
      depth: 0,
    });

    try {
      const result = await taskExecutor.run();

      if (this.uiType === MissionUIType.TUI && this.ui instanceof TuiMissionUi)
        this.ui.dispose();

      return {
        goal: this.mission.goal,
        result,
        trajectory: result.trajectory,
      };
    } finally {
      await closeDurableHarness();
    }
  }

  /** Directly handed definitions plus definitions loaded from agentsDir; direct wins by id. */
  private async mergedRoster(): Promise<AgentDefinition[]> {
    const merged = [...(this.agentDefs ?? [])];
    if (!this.agentsDir) return merged;
    for (const def of await loadAgents(this.agentsDir)) {
      if (!merged.some((d) => d.id === def.id)) merged.push(def);
    }
    return merged;
  }
}
