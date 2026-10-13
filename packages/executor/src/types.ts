import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { JsonObject } from '@earendil-works/pi-ai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import type { AgentDefinition } from './agent/agents.ts';
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
  /** The entry agent: its roster id, or the definition handed over directly. */
  entry: {
    agent: string | AgentDefinition;
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

export type ItemRef = string;

// -- Trajectory definitions (what a flow is made of)

export interface LlmTrajectoryDefinition {
  id: ItemRef;
  type: 'llm';
  systemPrompt?: string;
  description?: string;
  model?: { provider: string; modelId: string };
  tools: ChatCompletionTool[];
  task: string;
  depth: number;
  /** Set on child flows: the spawning agent and the tool call that spawned it. */
  parentAgentId?: string;
  spawnCallId?: string;
}

export interface UserTrajectoryDefinition {
  id: ItemRef;
  type: 'user';
  description?: string;
  ownerAgentId: string;
}

export interface ToolTrajectoryDefinition {
  id: ItemRef;
  type: 'tool';
  name: string;
  description?: string;
  params: unknown;
  ownerAgentId: string;
}

export type TrajectoryDefinitionItem =
  | LlmTrajectoryDefinition
  | UserTrajectoryDefinition
  | ToolTrajectoryDefinition;

// -- Trajectory traces (the flat, chronological flow record)

export interface LlmTrajectoryTrace {
  itemRef: ItemRef;
  message: ChatCompletionMessageParam;
  /** The tool set after a mid-run system change. */
  overridenTool?: ChatCompletionTool[];
}

export interface UserTrajectoryTrace {
  itemRef: ItemRef;
  message: string;
}

export interface ToolTrajectoryOutput {
  tool_call_id: string;
  content: unknown;
  isError?: boolean;
  /** The child flow's root llm definition, when this call spawned one. */
  childItemRef?: string;
}

export interface ToolTrajectoryTrace {
  itemRef: ItemRef;
  output: ToolTrajectoryOutput;
}

export type TrajectoryTrace =
  | LlmTrajectoryTrace
  | UserTrajectoryTrace
  | ToolTrajectoryTrace;

/** Links a contributing agent's raw transcript to the flat trace list. */
export interface TrajectorySourceRecord {
  itemRef: ItemRef;
  task: string;
  depth: number;
  context: AgentRunContext;
  transcript: SessionMessage[];
  traceMap: Array<{ transcriptIndex: number; traceIndex: number }>;
}

/** Everything one flow did — OpenAI-shaped, flat, chronological; child flows are flattened into it. */
export interface AgentTrajectory {
  flow: string;
  definition: TrajectoryDefinitionItem[];
  traces: TrajectoryTrace[];
  sourceRecords?: TrajectorySourceRecord[];
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
