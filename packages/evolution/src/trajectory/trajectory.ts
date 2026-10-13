import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionUserMessageParam,
} from 'openai/resources/chat/completions';
import type { ContextKind, Ref } from '../types.ts';

export type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionUserMessageParam,
};

export interface LlmDefinition {
  id: Ref;
  type: 'llm';
  systemPrompt?: string;
  description?: string;
  tools: readonly ChatCompletionTool[];
  model?: { provider: string; modelId: string };
}

export interface UserDefinition {
  id: Ref;
  type: 'user';
  description?: string;
}

export interface ToolDefinition {
  id: Ref;
  type: 'tool';
  name: string;
  description?: string;
  params: unknown;
}

export interface CodeDefinition {
  id: Ref;
  type: 'code';
  description?: string;
  params?: unknown;
}

export type DefinitionItem =
  | LlmDefinition
  | UserDefinition
  | ToolDefinition
  | CodeDefinition;

export interface LlmTrace {
  itemRef: Ref;
  overridenTool?: readonly ChatCompletionTool[];
  message: ChatCompletionMessageParam;
}

export interface UserTrace {
  itemRef: Ref;
  message: string | ChatCompletionUserMessageParam;
}

export interface ToolTrace {
  itemRef: Ref;
  output: {
    tool_call_id: string;
    content: unknown;
    isError?: boolean;
    childItemRef?: Ref;
  };
}

export interface CodeTrace {
  itemRef: Ref;
  output: unknown;
}

export type TrajectoryTrace = LlmTrace | UserTrace | ToolTrace | CodeTrace;

/** One complete flow: definition items plus their chronological trace. */
export interface Trajectory {
  flow: string;
  definition: readonly DefinitionItem[];
  traces: readonly TrajectoryTrace[];
}

export type StepKind = 'user' | 'system' | 'assistant' | 'tool' | 'code';

export interface RenderedContext {
  id: Ref;
  kind: ContextKind;
  content: string;
}

export interface TrajectoryEntry {
  agentId: Ref;
  ancestors: readonly Ref[];
  trace: TrajectoryTrace;
  ref: Ref;
  index: number;
}

export interface ToolCallDetails {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolResultDetails {
  callId: string;
  name: string;
  arguments: string;
  content: string;
  isError: boolean;
}

export function definitionFor(
  trajectory: Trajectory,
  itemRef: Ref,
): DefinitionItem | undefined {
  return trajectory.definition.find((item) => item.id === itemRef);
}

export function assertTrajectoryIntegrity(trajectory: Trajectory): void {
  const definitions = new Map<Ref, DefinitionItem>();
  for (const definition of trajectory.definition) {
    if (definitions.has(definition.id))
      throw new Error(`Duplicate trajectory definition id: ${definition.id}`);
    definitions.set(definition.id, definition);
  }
  for (const [index, trace] of trajectory.traces.entries()) {
    const definition = definitions.get(trace.itemRef);
    if (!definition)
      throw new Error(
        `Trace ${index} references missing definition: ${trace.itemRef}`,
      );
    const valid =
      definition.type === 'llm'
        ? 'message' in trace && typeof trace.message !== 'string'
        : definition.type === 'user'
          ? 'message' in trace &&
            (typeof trace.message === 'string' ||
              (typeof trace.message === 'object' &&
                trace.message !== null &&
                trace.message.role === 'user'))
          : definition.type === 'tool'
            ? 'output' in trace && isToolOutput(trace.output)
            : 'output' in trace;
    if (!valid)
      throw new Error(
        `Trace ${index} is incompatible with ${definition.type} item ${definition.id}`,
      );
  }
}

export function rootAgent(trajectory: Trajectory): LlmDefinition | undefined {
  const children = new Set(
    trajectory.traces.flatMap((trace) =>
      'output' in trace && isToolOutput(trace.output) && trace.output.childItemRef
        ? [trace.output.childItemRef]
        : [],
    ),
  );
  return trajectory.definition.find(
    (item): item is LlmDefinition =>
      item.type === 'llm' && !children.has(item.id),
  );
}

export function stepKind(
  trace: TrajectoryTrace,
  trajectory: Trajectory,
): StepKind {
  const definition = definitionFor(trajectory, trace.itemRef);
  if (!definition) return 'assistant';
  if (definition.type === 'llm') {
    return 'message' in trace &&
      typeof trace.message === 'object' &&
      trace.message !== null &&
      'role' in trace.message &&
      trace.message.role === 'system'
      ? 'system'
      : 'assistant';
  }
  if (definition.type === 'user') return 'user';
  return definition.type;
}

/** Stable trace reference: tool outputs use their OpenAI tool-call id. */
export function stepRef(trajectory: Trajectory, index: number): Ref {
  const trace = trajectory.traces[index];
  if (trace && 'output' in trace && isToolOutput(trace.output))
    return trace.output.tool_call_id;
  const owner = trace
    ? owningAgent(trajectory, trace, index)
    : rootAgent(trajectory)?.id;
  return `${owner ?? 'flow'}:${index}`;
}

export function renderedContexts(
  trajectory: Trajectory,
  agentId: Ref,
): RenderedContext[] {
  const agent = definitionFor(trajectory, agentId);
  if (agent?.type !== 'llm') return [];
  const contexts: RenderedContext[] = [
    {
      id: agent.id,
      kind: 'agent',
      content: agent.systemPrompt ?? '',
    },
  ];
  const byId = new Map<Ref, RenderedContext>();
  for (const tool of toolsOffered(trajectory, agentId)) {
    const name = chatToolName(tool);
    const id = toolRef(name);
    byId.set(id, {
      id,
      kind: 'tool',
      content: chatToolDescription(tool),
    });
  }
  return [...contexts, ...byId.values()];
}

/** Flat chronological walk; agent relationships come from linked tool outputs. */
export function walkTrajectory(trajectory: Trajectory): TrajectoryEntry[] {
  return trajectory.traces.map((trace, index) => {
    const agentId = owningAgent(trajectory, trace, index) ?? trace.itemRef;
    return {
      agentId,
      ancestors: ancestorsOf(trajectory, agentId),
      trace,
      ref: stepRef(trajectory, index),
      index,
    };
  });
}

export function stepText(trace: TrajectoryTrace): string {
  if ('message' in trace) {
    if (typeof trace.message === 'string') return trace.message;
    if (typeof trace.message !== 'object' || trace.message === null) return '';
    if (trace.message.role === 'assistant') {
      const content = contentText(trace.message.content);
      const calls = (trace.message.tool_calls ?? []).map((call) =>
        call.type === 'function'
          ? `${call.function.name} ${call.function.arguments}`
          : `${call.custom.name} ${call.custom.input}`,
      );
      const legacyCall = trace.message.function_call;
      return [
        content,
        trace.message.refusal ?? '',
        ...(legacyCall ? [`${legacyCall.name} ${legacyCall.arguments}`] : []),
        ...calls,
      ]
        .filter(Boolean)
        .join('\n');
    }
    return contentText(trace.message.content);
  }
  if ('output' in trace) {
    const output = trace.output;
    if (typeof output === 'object' && output !== null && 'content' in output)
      return contentText(output.content);
    return contentText(output);
  }
  return '';
}

export function allRuns(trajectory: Trajectory): LlmDefinition[] {
  return trajectory.definition.filter(
    (item): item is LlmDefinition => item.type === 'llm',
  );
}

export function toolsOffered(
  trajectory: Trajectory,
  agentId: Ref,
): ChatCompletionTool[] {
  const agent = definitionFor(trajectory, agentId);
  if (agent?.type !== 'llm') return [];
  const offered = new Map<string, ChatCompletionTool>();
  for (const tool of agent.tools) offered.set(chatToolName(tool), tool);
  for (const trace of trajectory.traces) {
    if (
      trace.itemRef === agentId &&
      'message' in trace &&
      'overridenTool' in trace &&
      trace.overridenTool
    ) {
      for (const tool of trace.overridenTool)
        if (!offered.has(chatToolName(tool)))
          offered.set(chatToolName(tool), tool);
    }
  }
  return [...offered.values()];
}

export function toolRef(name: string): Ref {
  return `tool:${name}`;
}

export function toolCallDetails(trace: TrajectoryTrace): ToolCallDetails[] {
  if (
    !('message' in trace) ||
    typeof trace.message !== 'object' ||
    trace.message === null ||
    trace.message.role !== 'assistant'
  )
    return [];
  return (trace.message.tool_calls ?? []).map((call) => ({
    id: call.id,
    name: call.type === 'function' ? call.function.name : call.custom.name,
    arguments:
      call.type === 'function' ? call.function.arguments : call.custom.input,
  }));
}

export function toolResultDetails(
  trajectory: Trajectory,
  trace: TrajectoryTrace,
): ToolResultDetails | undefined {
  if (!('output' in trace)) return undefined;
  const output = trace.output;
  if (!isToolOutput(output)) return undefined;
  const definition = definitionFor(trajectory, trace.itemRef);
  if (definition?.type !== 'tool') return undefined;
  const call = trajectory.traces
    .flatMap((candidate) => toolCallDetails(candidate))
    .find((candidate) => candidate.id === output.tool_call_id);
  return {
    callId: output.tool_call_id,
    name: definition.name,
    arguments: call?.arguments ?? '',
    content: contentText(output.content),
    isError: output.isError ?? false,
  };
}

function owningAgent(
  trajectory: Trajectory,
  trace: TrajectoryTrace,
  traceIndex: number,
): Ref | undefined {
  const definition = definitionFor(trajectory, trace.itemRef);
  if (definition?.type === 'llm') return definition.id;
  if ('output' in trace && isToolOutput(trace.output)) {
    const caller = callerOfToolCall(trajectory, trace.output.tool_call_id);
    if (caller) return caller;
  }
  for (let index = traceIndex + 1; index < trajectory.traces.length; index++) {
    const candidate = trajectory.traces[index];
    if (candidate && isLlmMessage(trajectory, candidate)) return candidate.itemRef;
  }
  for (let index = traceIndex - 1; index >= 0; index--) {
    const candidate = trajectory.traces[index];
    if (candidate && isLlmMessage(trajectory, candidate)) return candidate.itemRef;
  }
  return rootAgent(trajectory)?.id;
}

function ancestorsOf(trajectory: Trajectory, agentId: Ref): Ref[] {
  const ancestors: Ref[] = [];
  let current: Ref | undefined = agentId;
  while (current) {
    const parent = parentAgentOf(trajectory, current);
    if (!parent) break;
    ancestors.push(parent);
    current = parent;
  }
  return ancestors;
}

function parentAgentOf(trajectory: Trajectory, childRef: Ref): Ref | undefined {
  for (const trace of trajectory.traces) {
    if (
      'output' in trace &&
      isToolOutput(trace.output) &&
      trace.output.childItemRef === childRef
    )
      return callerOfToolCall(trajectory, trace.output.tool_call_id);
  }
  return undefined;
}

function callerOfToolCall(trajectory: Trajectory, callId: string): Ref | undefined {
  return trajectory.traces.find(
    (trace) =>
      'message' in trace &&
      typeof trace.message === 'object' &&
      trace.message !== null &&
      trace.message.role === 'assistant' &&
      trace.message.tool_calls?.some((call) => call.id === callId),
  )?.itemRef;
}

function isLlmMessage(trajectory: Trajectory, trace: TrajectoryTrace): boolean {
  return (
    definitionFor(trajectory, trace.itemRef)?.type === 'llm' &&
    'message' in trace
  );
}

function isToolOutput(output: unknown): output is ToolTrace['output'] {
  return (
    typeof output === 'object' &&
    output !== null &&
    'tool_call_id' in output &&
    typeof output.tool_call_id === 'string'
  );
}

function chatToolName(tool: ChatCompletionTool): string {
  return tool.type === 'function' ? tool.function.name : tool.custom.name;
}

function chatToolDescription(tool: ChatCompletionTool): string {
  return tool.type === 'function' ? (tool.function.description ?? '') : '';
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part === 'object' && part !== null && 'text' in part)
          return typeof part.text === 'string' ? part.text : '';
        return '';
      })
      .filter(Boolean)
      .join('\n');
  if (content === null || content === undefined) return '';
  return JSON.stringify(content);
}
