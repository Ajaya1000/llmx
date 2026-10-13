import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionUserMessageParam,
} from 'openai/resources/chat/completions';

export type ItemRef = string;

// -- Definition items

export interface LlmDefinition {
  id: ItemRef;
  type: 'llm';
  systemPrompt?: string;
  description?: string;
  model?: { provider: string; modelId: string };
  tools: ChatCompletionTool[];
}

export interface UserDefinition {
  id: ItemRef;
  type: 'user';
  description?: string;
}

export interface ToolDefinition {
  id: ItemRef;
  type: 'tool';
  name: string;
  description?: string;
  params: unknown;
}

export interface CodeDefinition {
  id: ItemRef;
  type: 'code';
  description?: string;
  params?: unknown;
}

export type DefinitionItem =
  | LlmDefinition
  | UserDefinition
  | ToolDefinition
  | CodeDefinition;

// -- Traces

export interface LlmTrace {
  itemRef: ItemRef; // references LlmDefinition
  overridenTool?: ChatCompletionTool[];
  message: ChatCompletionMessageParam;
}

export interface UserTrace {
  itemRef: ItemRef; // references UserDefinition
  message: string | ChatCompletionUserMessageParam;
}

export interface ToolTraceOutput {
  tool_call_id: string;
  content: unknown;
  isError?: boolean;
}

export interface ToolTrace {
  itemRef: ItemRef; // references ToolDefinition
  output: ToolTraceOutput;
}

export interface CodeTrace {
  itemRef: ItemRef; // references CodeDefinition
  output: unknown;
}

export type Trace = LlmTrace | UserTrace | ToolTrace | CodeTrace;

export interface Trajectory {
  flow: string; // contents of flow.md
  definition: DefinitionItem[];
  traces: Trace[]; // chronological; child-agent traces are flattened here
}

export * from './distiller/index.js';
export * from './distiller/prompt.js';
export { TrajectoryStore } from './store.js';
