import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type {
  AssistantMessage,
  SystemMessage,
  ToolResultMessage,
  UserMessage,
} from '@earendil-works/pi-ai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import type {
  AgentRunContext,
  AgentTrajectory,
  LlmTrajectoryDefinition,
  SessionMessage,
  TrajectoryDefinitionItem,
  TrajectoryTrace,
} from '../types.ts';

export interface BuildTrajectoryInput {
  agentId: string;
  task: string;
  depth: number;
  flow?: string;
  description?: string;
  context: AgentRunContext;
  transcript: SessionMessage[];
  /** Child trajectories keyed by the parent tool-call id that spawned them. */
  children?: ReadonlyMap<string, AgentTrajectory>;
}

/** Converts an executor transcript into OpenAI-shaped, flow-wide flat traces. */
export function buildTrajectory(input: BuildTrajectoryInput): AgentTrajectory {
  const llm: LlmTrajectoryDefinition = {
    id: input.agentId,
    type: 'llm',
    systemPrompt: input.context.instructions,
    description: input.description,
    tools: input.context.tools.map(toOpenAiTool),
    model: input.context.model,
    task: input.task,
    depth: input.depth,
  };
  const definitions: TrajectoryDefinitionItem[] = [
    llm,
    {
      id: userRef(input.agentId),
      type: 'user',
      description: `Input to ${input.agentId}`,
      ownerAgentId: input.agentId,
    },
    ...input.context.tools.map((tool) => toolDefinition(tool, input.agentId)),
  ];
  const traces: TrajectoryTrace[] = [];
  const traceMap: {
    transcriptIndex: number;
    traceIndex: number;
  }[] = [];
  const sourceRecords: NonNullable<AgentTrajectory['sourceRecords']>[number][] =
    [
      {
        itemRef: input.agentId,
        task: input.task,
        depth: input.depth,
        context: input.context,
        transcript: input.transcript,
        traceMap,
      },
    ];
  const appendTrace = (trace: TrajectoryTrace, transcriptIndex: number) => {
    traceMap.push({ transcriptIndex, traceIndex: traces.length });
    traces.push(trace);
  };
  const definitionsById = new Map(definitions.map((item) => [item.id, item]));
  const activeTools = new Map(
    input.context.tools.map((tool) => [tool.name, toOpenAiTool(tool)]),
  );
  const toolNamesByCallId = new Map<string, string>();

  for (const [messageIndex, message] of input.transcript.entries()) {
    if (!isKnownMessage(message)) continue;
    switch (message.role) {
      case 'system': {
        let changed = false;
        for (const tool of message.toolsAdded ?? []) {
          activeTools.set(tool.name, toOpenAiTool(tool));
          addDefinition(definitionsById, toolDefinition(tool, input.agentId));
          changed = true;
        }
        for (const removed of message.toolsRemoved ?? []) {
          changed = activeTools.delete(removed.name) || changed;
        }
        const trace: TrajectoryTrace = {
          itemRef: input.agentId,
          message: { role: 'system', content: blocksToText(message.content) },
          ...(changed ? { overridenTool: [...activeTools.values()] } : {}),
        };
        appendTrace(trace, messageIndex);
        break;
      }
      case 'user':
        appendTrace(
          {
            itemRef: userRef(input.agentId),
            message: blocksToText(message.content),
          },
          messageIndex,
        );
        break;
      case 'assistant': {
        const toolCalls = message.content.filter(
          (block) => block.type === 'toolCall',
        );
        for (const call of toolCalls) toolNamesByCallId.set(call.id, call.name);
        const normalized: ChatCompletionMessageParam = {
          role: 'assistant',
          content: blocksToText(message.content) || null,
          ...(toolCalls.length > 0
            ? {
                tool_calls: toolCalls.map((call) => ({
                  id: call.id,
                  type: 'function' as const,
                  function: {
                    name: call.name,
                    arguments: JSON.stringify(call.arguments),
                  },
                })),
              }
            : {}),
        };
        appendTrace(
          { itemRef: input.agentId, message: normalized },
          messageIndex,
        );
        break;
      }
      case 'toolResult': {
        const name =
          message.toolName ??
          toolNamesByCallId.get(message.toolCallId) ??
          'unknown';
        addDefinition(
          definitionsById,
          toolDefinition(
            { name, description: '', parameters: {} },
            input.agentId,
          ),
        );
        const child = input.children?.get(message.toolCallId);
        const childRoot = child ? rootLlm(child) : undefined;
        if (child && childRoot) {
          const childDefinitions = child.definition.map((definition) =>
            definition.id === childRoot.id
              ? {
                  ...definition,
                  parentAgentId: input.agentId,
                  spawnCallId: message.toolCallId,
                }
              : definition,
          );
          for (const definition of childDefinitions)
            addDefinition(definitionsById, definition);
          const childTraceOffset = traces.length;
          traces.push(...child.traces);
          sourceRecords.push(
            ...(child.sourceRecords ?? []).map((record) => ({
              ...record,
              traceMap: record.traceMap?.map((link) => ({
                ...link,
                traceIndex: link.traceIndex + childTraceOffset,
              })),
            })),
          );
        }
        const output: Extract<TrajectoryTrace, { output: unknown }>['output'] =
          {
            tool_call_id: message.toolCallId,
            content: message.content,
            isError: message.isError,
            ...(childRoot ? { childItemRef: childRoot.id } : {}),
          };
        appendTrace({ itemRef: toolRef(name), output }, messageIndex);
        break;
      }
    }
  }

  return {
    flow: input.flow ?? input.task,
    definition: [...definitionsById.values()],
    traces,
    sourceRecords,
  };
}

/** Renders the flattened flow in trace order for logs and CLI output. */
export function renderTrajectory(
  trajectory: AgentTrajectory,
  maxChars = 160,
): string {
  const lines: string[] = [`Flow: ${clip(trajectory.flow, maxChars)}`];
  for (const trace of trajectory.traces) {
    if ('message' in trace && typeof trace.message === 'object') {
      const message = trace.message;
      if (message.role === 'assistant') {
        const text = blocksToText(message.content ?? '');
        lines.push(
          `[${trace.itemRef}] ${clip(text, maxChars)}`.trimEnd(),
          ...(message.tool_calls ?? []).map(
            (call) =>
              `[${trace.itemRef}] [tool ${call.type === 'function' ? call.function.name : call.custom.name}]`,
          ),
        );
      } else if (message.role === 'system') {
        lines.push(
          `[${trace.itemRef}] [system] ${clip(blocksToText(message.content), maxChars)}`,
        );
      }
      continue;
    }
    if ('message' in trace && typeof trace.message === 'string') {
      lines.push(`[${trace.itemRef}] > ${clip(trace.message, maxChars)}`);
      continue;
    }
    const definition = trajectory.definition.find(
      (item) => item.id === trace.itemRef,
    );
    if ('output' in trace && definition?.type === 'tool') {
      const output = trace.output as {
        tool_call_id?: string;
        content?: unknown;
      };
      lines.push(
        `[${trace.itemRef}] [tool result] ${clip(blocksToText(output.content), maxChars)}`,
      );
    }
  }
  return lines.join('\n');
}

function rootLlm(
  trajectory: AgentTrajectory,
): LlmTrajectoryDefinition | undefined {
  return trajectory.definition.find(
    (definition): definition is LlmTrajectoryDefinition =>
      definition.type === 'llm' && definition.parentAgentId === undefined,
  );
}

function isKnownMessage(
  message: AgentMessage,
): message is
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolResultMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'role' in message &&
    ['system', 'user', 'assistant', 'toolResult'].includes(message.role)
  );
}

function toOpenAiTool(tool: {
  name: string;
  description: string;
  parameters: unknown;
}): ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as Record<string, unknown>,
    },
  };
}

function toolDefinition(
  tool: { name: string; description: string; parameters: unknown },
  ownerAgentId: string,
): TrajectoryDefinitionItem {
  return {
    id: toolRef(tool.name),
    type: 'tool',
    name: tool.name,
    description: tool.description,
    params: tool.parameters,
    ownerAgentId,
  };
}

function addDefinition(
  definitions: Map<string, TrajectoryDefinitionItem>,
  definition: TrajectoryDefinitionItem,
): void {
  if (!definitions.has(definition.id))
    definitions.set(definition.id, definition);
}

function blocksToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        typeof block === 'object' &&
        block !== null &&
        'type' in block &&
        block.type === 'text' &&
        'text' in block &&
        typeof block.text === 'string',
    )
    .map((block) => block.text)
    .join('\n');
}

function userRef(agentId: string): string {
  return `user:${agentId}`;
}

function toolRef(name: string): string {
  return `tool:${name}`;
}

function clip(text: string, maxChars: number): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > maxChars ? `${one.slice(0, maxChars - 1)}…` : one;
}
