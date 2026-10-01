import { type AgentDefinition, loadAgents } from '../agent/agents.js';
import { DefaultTaskExecutorFactory, TaskExecutorFactory } from '../factory/taskExecutorFactory.js';
import { AgentSessionRepository } from '../repository/agent-session.js';
import { DefaultToolProvider, ToolProvider } from '../tools/toolProvider.js';
import type { Mission, MissionResult, MissionUi } from '../types.js';
import { LogMissionUi } from './logger.js';
import { TuiMissionUi } from './tui.js';

export enum MissionUIType {
  TUI, // terminal UI
  LOG // normal terminal logs
}
export interface MissionManagerOptions {
  /** Absolute bound on agent nesting. Default: 8. */
  maxSpawnDepth?: number;
  cwd?: string;
  agentsDir?: string;
  uiType: MissionUIType,
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
  private taskExecutorFactory?: TaskExecutorFactory
  private toolProvider?: ToolProvider

  constructor(options: MissionManagerOptions) {
    this.maxSpawnDepth = options.maxSpawnDepth ?? 8;
    this.cwd = options.cwd;
    this.agentsDir = options.agentsDir;
    this.mission = options.mission;
    this.uiType = options.uiType;
    this.ui =
      options.uiType === MissionUIType.TUI ? new TuiMissionUi() : new LogMissionUi();
    this.repository = new AgentSessionRepository();
  }

  async run(): Promise<MissionResult> {
    this.agentDefs = this.agentsDir ? await loadAgents(this.agentsDir) : [];

    if (this.uiType === MissionUIType.TUI && this.ui instanceof TuiMissionUi) this.ui.start();

    const _taskExecutorFactory = new DefaultTaskExecutorFactory({
      agentDefs: this.agentDefs,
      repository: this.repository,
      maxSpawnDepth: this.maxSpawnDepth,
      ui: this.ui,
      cwd: this.cwd
    })

    const _toolProvider = new DefaultToolProvider({
      factory: _taskExecutorFactory
    })

    this.taskExecutorFactory = _taskExecutorFactory
    this.toolProvider = _toolProvider

    const entry = _taskExecutorFactory.create({
      task: this.mission.entry.task,
      agentId: this.mission.entry.name,
      depth: 0,
      toolProvider: _toolProvider
    })

    const result = await entry.run();

    if (this.uiType === MissionUIType.TUI && this.ui instanceof TuiMissionUi) this.ui.dispose();

    return {
      goal: this.mission.goal,
      result
    };
  }
}
