import { type AgentDefinition, loadAgents } from '../agent/agents.ts';
import {
  DefaultTaskExecutorFactory,
  type TaskExecutorFactory,
} from '../agent/taskExecutorFactory.ts';
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
  agentsDir?: string;
  uiType: MissionUIType;
  mission: Mission;
}

export class MissionManager {
  private readonly repository: AgentSessionRepository;
  private readonly maxSpawnDepth: number;
  private readonly cwd?: string;
  private readonly agentsDir?: string;
  private readonly ui: MissionUi;
  private readonly uiType: MissionUIType;
  private readonly mission: Mission;
  private agentDefs?: AgentDefinition[];
  private taskExecutorFactory?: TaskExecutorFactory;

  constructor(options: MissionManagerOptions) {
    this.maxSpawnDepth = options.maxSpawnDepth ?? 8;
    this.cwd = options.cwd;
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
    this.agentDefs = this.agentsDir ? await loadAgents(this.agentsDir) : [];

    if (this.uiType === MissionUIType.TUI && this.ui instanceof TuiMissionUi)
      this.ui.start();

    const _taskExecutorFactory = new DefaultTaskExecutorFactory({
      agentDefs: this.agentDefs,
      repository: this.repository,
      maxSpawnDepth: this.maxSpawnDepth,
      ui: this.ui,
      cwd: this.cwd,
    });

    this.taskExecutorFactory = _taskExecutorFactory;

    const entry = _taskExecutorFactory.create({
      task: this.mission.entry.task,
      agentId: this.mission.entry.name,
      depth: 0,
    });

    try {
      const result = await entry.run();

      if (this.uiType === MissionUIType.TUI && this.ui instanceof TuiMissionUi)
        this.ui.dispose();

      return {
        goal: this.mission.goal,
        result,
      };
    } finally {
      await closeDurableHarness();
    }
  }
}
