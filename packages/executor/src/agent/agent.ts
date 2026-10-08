import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { DurableAgentSession } from '../durable/durable-session.ts';
import { AgentSessionRepository } from '../durable/index.ts';
import type { SpawnHandler } from '../durable/spawn-tool.ts';
import type { AgentRunResult, AgentTrajectory, MissionUi } from '../types.ts';
import type { AgentDefinition } from './agents.ts';
import { buildTrajectory } from './trajectory.ts';

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
  /** Hard bound on nesting; needed to hide spawn_agent at the leaf. */
  maxSpawnDepth?: number;
  cwd?: string;
  repository?: AgentSessionRepository;
  /** Injected by the factory; when absent, this conversation gets no spawn_agent tool. */
  spawn?: SpawnHandler;
  /** Definitions this agent may spawn, resolved by the factory (mirrors spawn()'s allowlist). */
  subagents?: AgentDefinition[];
}

export class TaskExecutor {
  readonly agentId: string;
  private readonly task: string;
  private readonly definition: AgentDefinition;
  private readonly depth: number;
  private readonly maxSpawnDepth?: number;
  private readonly cwd?: string;
  private readonly repository: AgentSessionRepository;
  private readonly ui: MissionUi;
  private readonly spawn?: SpawnHandler;
  private readonly subagents?: AgentDefinition[];

  private session?: DurableAgentSession;
  /** Child trajectories from this run, keyed by the spawn_agent tool callId. */
  private children = new Map<string, AgentTrajectory>();

  constructor(options: AgentOptions) {
    this.agentId = options.agentId;
    this.task = options.task;
    this.definition = options.definition;
    this.depth = options.depth;
    this.maxSpawnDepth = options.maxSpawnDepth;
    this.cwd = options.cwd;
    this.repository = options.repository ?? new AgentSessionRepository();
    this.ui = options.ui;
    this.spawn = options.spawn;
    this.subagents = options.subagents;
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

  /** Runs the agent: fresh durable conversation → one prompt (pi-durable drives the tool loop, including spawn_agent). */
  async run(): Promise<AgentRunResult> {
    this.children = new Map();
    this.session = await this.repository.createSession({
      ...(this.cwd ? { cwd: this.cwd } : {}),
      agentContext: {
        agentId: this.agentId,
        depth: this.depth,
        maxSpawnDepth: this.maxSpawnDepth,
      },
      ...(this.spawn ? { spawn: this.trackChildren(this.spawn) } : {}),
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

    // One raw copy, shared by AgentRunResult.transcript and the trajectory.
    const transcript = [...this.session.messages];
    const result: AgentRunResult = {
      agentId: this.agentId,
      text: this.getFinalText(),
      transcript,
      trajectory: buildTrajectory({
        agentId: this.agentId,
        task: this.task,
        depth: this.depth,
        context: this.session.getRunContext(),
        transcript,
        children: this.children,
      }),
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

  /** Wraps the spawn handler so every child's trajectory is kept, keyed by the parent tool call that spawned it. */
  private trackChildren(spawn: SpawnHandler): SpawnHandler {
    return async (input) => {
      const spawned = await spawn(input);
      if (spawned?.trajectory) {
        this.children.set(input.callId, spawned.trajectory);
      }
      return spawned;
    };
  }

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
    );

    // Only agents that can actually spawn see the subagent roster and the
    // delegation policy (leaf agents have no spawn_agent tool).
    if (this.spawn) {
      const roster = this.subagents ?? [];
      if (roster.length > 0) {
        parts.push(
          '',
          '## Available subagents (via spawn_agent)',
          ...roster.map((sub) => this.describeSubagent(sub)),
          '',
          '## Delegation policy — strict',
          '- If a listed subagent provides the capability a step needs, you MUST delegate that step with spawn_agent. Never perform such a step yourself.',
          '- Solve a step yourself only when no listed subagent covers it.',
          '- Pass the agent id and only the context the child needs; its final summary is your tool result.',
        );
      } else {
        parts.push(
          '',
          '- Delegate by calling spawn_agent; pass the agent id and only the context the child needs.',
        );
      }
    }

    parts.push(
      '',
      'Notes:',
      // '- Commit your working state with commit_state before handing control back or delegating.',
      '- Your final assistant message is what your parent (or the user) receives — make it a self-contained summary.',
    );
    return parts.join('\n');
  }

  /** One roster line: id — title: description, plus the edge's forward description as an entering note. */
  private describeSubagent(sub: AgentDefinition): string {
    const edge = this.definition?.edges.find((e) => e.target === sub.id);
    const bridge = edge?.forwardDescription
      ? ` Entering note: ${edge.forwardDescription}`
      : '';
    return `- ${sub.id} — ${sub.title}: ${sub.description}.${bridge}`;
  }

  private assertSession(): void {
    if (!this.session) {
      throw new Error(
        `Agent ${this.agentId} has not run yet: call run() first`,
      );
    }
  }
}
