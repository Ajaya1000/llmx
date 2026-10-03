import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type {
  AgentSession,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { AgentSessionRepository } from '../repository/agent-session.js';
import type { ToolProvider } from '../tools/toolProvider.js';
import type { AgentRunResult, MissionUi } from '../types.js';
import type { AgentDefinition } from './agents.js';

export interface AgentOptions {
  /** Stable identifier, assigned by the MissionManager (e.g. "agent-1"). */
  agentId: string;
  /** This agent's task. */
  task: string;
  /**live view of the mission; every event is also handed to it, parent → child. */
  ui: MissionUi;
  /** This agent's own definition, if it was spawned from one. */
  definition: AgentDefinition;
  /** Nesting depth — root is 0. */
  depth: number;
  cwd?: string;
  repository?: AgentSessionRepository;
  toolProvider?: ToolProvider;
}

export class TaskExecutor {
  readonly agentId: string;
  private readonly task: string;
  private readonly definition: AgentDefinition;
  private readonly depth: number;
  private readonly cwd?: string;
  private readonly repository: AgentSessionRepository;
  private readonly ui: MissionUi;
  private readonly toolProvider?: ToolProvider;

  private session?: AgentSession;

  constructor(options: AgentOptions) {
    this.agentId = options.agentId;
    this.task = options.task;
    this.definition = options.definition;
    this.depth = options.depth;
    this.cwd = options.cwd;
    this.repository = options.repository ?? new AgentSessionRepository();
    this.ui = options.ui;
    this.toolProvider = options.toolProvider;
  }

  /** The agent's transcript — pi owns it; valid until dispose(). */
  getMessages(): AgentMessage[] {
    this.assertSession();
    return this.session!.messages;
  }

  /** The agent's final assistant text (the complete state of its last turn). */
  getFinalText(): string {
    this.assertSession();
    return this.session!.getLastAssistantText() ?? '';
  }

  /** Runs the agent: session → one prompt (pi drives the tool loop, including nested agent spawns). */
  async run(): Promise<AgentRunResult> {
    this.session = await this.repository.createSession({
      ...(this.cwd ? { cwd: this.cwd } : {}),
      customTools: this.tools(),
    });

    this.ui.agentStarted(this.agentId, this.task);
    const unsubscribe = this.session.subscribe((event) =>
      this.ui.agentEvent(this.agentId, event),
    );

    try {
      await this.session.prompt(this.composeSeed());
    } finally {
      unsubscribe?.();
    }

    const result: AgentRunResult = {
      agentId: this.agentId,
      text: this.getFinalText(),
      transcript: [...this.session.messages],
    };
    this.ui.agentFinished(this.agentId, result.text);
    return result;
  }

  /** Disposes the session — the transcript (CoT) is discarded. */
  dispose(): void {
    this.session?.dispose();
    this.session = undefined;
  }

  // ------------------------------------------------------------------

  private composeSeed(): string {
    const def = this.definition;
    const parts: string[] = [];

    if (def) {
      parts.push(
        `You are ${this.agentId} — ${def.title}:`,
        def.description,
        '',
        `Pre-state (advisory): ${JSON.stringify(def.preState)}`,
        `Post-state: ${JSON.stringify(def.postState)}`,
        '',
        '## Procedure',
        def.body,
      );
    }

    parts.push(
      '',
      `Your input (you are ${this.agentId}${def ? '' : ' — no agent definition; the input below IS your full task'}):`,
      this.task,
      '',
      'Notes:',
      '- Delegate by calling spawn_agent; pass the agent id (if definitions allow) and only the context the child needs.',
      '- Commit your working state with commit_state before handing control back or delegating.',
      '- Your final assistant message is what your parent (or the user) receives — make it a self-contained summary.',
    );
    return parts.join('\n');
  }

  private tools(): Array<ToolDefinition> | undefined {
    return this.toolProvider?.tools({
      agent: this.definition,
      depth: this.depth,
    });
  }

  private assertSession(): void {
    if (!this.session) {
      throw new Error(
        `Agent ${this.agentId} has not run yet: call run() first`,
      );
    }
  }
}
