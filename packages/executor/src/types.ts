import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type {
  JsonObject,
  SystemMessage,
  TextContent,
  ThinkingContent,
  ToolCall,
  UserMessage,
} from '@earendil-works/pi-ai';
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

/** A tool exactly as the model was offered it — its declaration. */
export interface AgentToolDescription {
  name: string;
  description: string;
  /** The tool's parameter schema, as JSON. */
  parameters: JsonObject;
}

/** The resolved model-side context one agent ran with. */
export interface AgentRunContext {
  model?: { provider: string; modelId: string };
  /** Every tool offered to the model, in offer order. */
  tools: AgentToolDescription[];
  /** The agent's instructions (system prompt text), when set. */
  instructions?: string;
}

/** One recorded step in an agent's run, in order — provider shapes, unchanged. */
export type TrajectoryStep =
  | SystemMessage
  | UserMessage
  | TextContent
  | ThinkingContent
  | (ToolCall & {
      /** The executed tool's result text, filled from the toolResult message. */
      result: string;
      isError: boolean;
      /** The spawned agent's full trajectory, when this step was a spawn_agent call that ran a child. */
      child?: AgentTrajectory;
    });

/** Everything one agent did in its run — the node unit of the trajectory tree. */
export interface AgentTrajectory {
  agentId: string;
  task: string;
  /** 0 for the entry agent; parent depth + 1 for spawned agents. Redundant with nesting, but makes flat rendering trivial. */
  depth: number;
  /** The model-side context this agent ran with — the "tools given" record. */
  context: AgentRunContext;
  /** The RAW transcript — every message verbatim, system messages included; nothing filtered, nothing flattened. */
  transcript: SessionMessage[];
  /** The derived, lossless ordered step view (readability + rendering); `transcript` stays the source of truth. */
  steps: TrajectoryStep[];
}

/** One agent's own run result — its final text is what the parent's spawn tool call receives. */
export interface AgentRunResult {
  agentId: string;
  text: string;
  transcript: SessionMessage[];
  /** This agent's steps, with every spawned child nested under its spawn_agent step. */
  trajectory: AgentTrajectory;
}

/** The final result of a mission. */
export interface MissionResult {
  goal: string;
  /** Parent-child relations created by spawn_agent calls, flattened. */
  // spawns: Array<{ parentId: string; childId: string; task: string }>;
  /** Every agent's final output. */
  result: AgentRunResult;
  /** The entry agent's trajectory — every nested spawn included. */
  trajectory: AgentTrajectory;
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
