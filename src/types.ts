import type {
  AgentSession,
  AgentSessionEvent,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

export type { AgentSession, AgentSessionEvent, ToolDefinition };

/** A pi transcript message (user / assistant / toolResult) — the unit of every agent session. */
export type SessionMessage = AgentMessage;

/** The mission a user hands to the system — one goal, one entry agent, shared environment. */
export interface Mission {
  goal: string;
  /** The agent that starts the mission; every further agent is spawned from a parent via a tool call. */
  entry: {
    name: string;
    task: string;
  };
  /** Environment properties passed down to every agent (see Environment). */
  properties?: Record<string, string>;
}

/** A working state commit — an agent's slate at a point in time. In-memory only; never persisted across sessions. Can be consumed by the WikiMaintainer. */
export interface WorkingSlate {
  agentId: string;
  committedAt: number;
  content: Record<string, unknown>;
  note?: string;
}

export type WikiEntryKind = 'failure' | 'lesson';

export interface WikiEntry {
  id: string;
  kind: WikiEntryKind;
  agentId: string;
  content: string;
  createdAt: number;
}

/** Distilled experience for agents. Consumes working slates and failures; hands lessons back. */
export interface WikiMaintainer {
  /** Ingest a working slate (e.g. after teardown) so it can be distilled later. */
  recordSlate(slate: WorkingSlate): void;
  /** Record a failure or lesson produced by an agent. */
  recordEntry(agentId: string, kind: WikiEntryKind, content: string): WikiEntry;
  /** The current lesson store — seeds every agent's context. */
  lessons(): WikiEntry[];
}

/** In-memory working-state commit store, shared across the agents of one mission. */
export interface CommitStore {
  commit(
    agentId: string,
    content: Record<string, unknown>,
    note?: string
  ): WorkingSlate;
  all(): WorkingSlate[];
  byAgent(agentId: string): WorkingSlate[];
}

/** The environment a MissionManager provides and passes down to every agent. */
export interface Environment {
  id: string;
  properties: Record<string, string>;
  /** Working-state commits from every agent in the mission (not persisted across sessions). */
  commits: CommitStore;
  /** A human-readable description of the environment — enters every agent's seed prompt. */
  describe(): string;
}

/** One agent's own run result — its final text is what the parent's spawn tool call receives. */
export interface AgentRunResult {
  agentId: string;
  text: string;
  transcript: SessionMessage[];
}

/** The final result of a mission. */
export interface MissionResult {
  goal: string;
  /** Parent-child relations created by spawn_agent calls, flattened. */
  // spawns: Array<{ parentId: string; childId: string; task: string }>;
  /** Every agent's final output. */
  result: AgentRunResult;
}

/**
 * Optional live view of what is happening during a mission. A `ui` passed to
 * MissionManager is handed to every agent (parent→child) and receives lifecycle
 * and session events; implement nothing to run fully silent.
 */
export interface MissionUi {
  agentStarted(agentId: string, task: string): void;
  agentFinished(agentId: string, text: string): void;
  agentEvent(agentId: string, event: AgentSessionEvent): void;
}
