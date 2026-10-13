import type { AgentDefinition, MissionManagerOptions } from '@llmx/executor';
import { MissionManager, MissionUIType } from '@llmx/executor';

/** What one agentic run reports back to its caller. */
export interface AgenticRunOutcome {
  /** The agent's final answer text. */
  summary: string;
}

/** The harness seam: an execution engine that runs a system prompt + task with tools. */
export interface AgenticExecutor {
  run(input: {
    systemPrompt: string;
    task: string;
    cwd: string;
  }): Promise<AgenticRunOutcome>;
}

/** Profile of the mission agent: handed straight to MissionManager, no name/dir loading. */
export interface AgenticAgentProfile {
  id: string;
  title: string;
  description: string;
  /** The mission's goal, as reported in the result. */
  goal: string;
  /** Agent definitions the entry agent's delegates may spawn. */
  subagentDefs?: AgentDefinition[];
  /** Absolute bound on delegate nesting. Default: MissionManager's 8. */
  maxSpawnDepth?: number;
  uiType?: MissionUIType;
}

/** Creates the manager that runs one mission (injected in tests). */
export type MissionRunnerFactory = (
  options: MissionManagerOptions,
) => Pick<MissionManager, 'run'>;

/** Agentic executor backed by @llmx/executor's MissionManager: one run = one mission. */
export class MissionAgenticExecutor implements AgenticExecutor {
  private readonly profile: AgenticAgentProfile;
  private readonly createRunner: MissionRunnerFactory;

  constructor(
    profile: AgenticAgentProfile,
    createRunner: MissionRunnerFactory = (options) =>
      new MissionManager(options),
  ) {
    this.profile = profile;
    this.createRunner = createRunner;
  }

  async run(input: {
    systemPrompt: string;
    task: string;
    cwd: string;
  }): Promise<AgenticRunOutcome> {
    const {
      id,
      title,
      description,
      goal,
      subagentDefs,
      maxSpawnDepth,
      uiType,
    } = this.profile;
    const entry: AgentDefinition = {
      id,
      title,
      description,
      preState: {},
      postState: {},
      tools: [],
      edges: [],
      metadata: { created: new Date().toISOString() },
      domain: id,
      body: input.systemPrompt,
    };
    const result = await this.createRunner({
      mission: { goal, entry: { agent: entry, task: input.task } },
      agentDefs: subagentDefs,
      maxSpawnDepth,
      cwd: input.cwd,
      uiType: uiType ?? MissionUIType.LOG,
    }).run();
    return { summary: result.result.text ?? '' };
  }
}
