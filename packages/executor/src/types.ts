import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type {
  AgentSessionEvent,
  DurableAgentSession,
} from './durable/durable-session.ts';

export type {
  AgentMessage,
  AgentSessionEvent,
  DurableAgentSession as AgentSession,
};

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
  /** Record a failure or lesson produced by an agent. */
  recordEntry(agentId: string, kind: WikiEntryKind, content: string): WikiEntry;
  /** The current lesson store — seeds every agent's context. */
  lessons(): WikiEntry[];
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
