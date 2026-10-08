import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type {
  AgentRunContext,
  AgentTrajectory,
  SessionMessage,
  TrajectoryStep,
} from '../types.ts';

export interface BuildTrajectoryInput {
  agentId: string;
  task: string;
  depth: number;
  /** The resolved run context — model, offered tools, instructions. */
  context: AgentRunContext;
  /** The RAW transcript, stored verbatim on the trajectory (nothing filtered). */
  transcript: SessionMessage[];
  /** Spawned children keyed by the parent's spawn_agent tool callId. */
  children?: ReadonlyMap<string, AgentTrajectory>;
}

/**
 * Assembles one agent's trajectory: the run context and raw transcript
 * verbatim, plus a derived lossless step view. Child trajectories nest under
 * the exact spawn_agent tool step that produced them (matched by callId), so
 * nesting survives parallel tool calls.
 */
export function buildTrajectory(input: BuildTrajectoryInput): AgentTrajectory {
  return {
    agentId: input.agentId,
    task: input.task,
    depth: input.depth,
    context: input.context,
    transcript: input.transcript,
    steps: stepsFrom(input.transcript, input.children),
  };
}

/**
 * The ordered step view — lossless: system messages and every assistant block
 * (even empty text) survive verbatim; only a toolCall block gains its executed
 * result and the spawned child. `transcript` stays the source of truth.
 */
function stepsFrom(
  messages: readonly AgentMessage[],
  children?: ReadonlyMap<string, AgentTrajectory>,
): TrajectoryStep[] {
  type ToolStep = Extract<TrajectoryStep, { type: 'toolCall' }>;
  const steps: TrajectoryStep[] = [];
  const toolSteps = new Map<string, ToolStep>();

  for (const message of messages) {
    switch (message.role) {
      case 'system':
      case 'user':
        steps.push(message);
        break;
      case 'assistant':
        for (const block of message.content) {
          if (block.type === 'toolCall') {
            const step: ToolStep = {
              ...block,
              result: '',
              isError: false,
            };
            steps.push(step);
            toolSteps.set(block.id, step);
          } else {
            steps.push(block);
          }
        }
        break;
      case 'toolResult': {
        const step = toolSteps.get(message.toolCallId);
        if (step) {
          step.result = blocksToText(message.content);
          step.isError = message.isError;
        }
        break;
      }
      default:
        break; // unknown/custom roles stay in `transcript`, not `steps`
    }
  }

  if (children) {
    for (const [callId, child] of children) {
      const step = toolSteps.get(callId);
      if (step) step.child = child;
    }
  }

  return steps;
}

/** One line per step, indented by nesting depth — nested runs are visually obvious. */
export function renderTrajectory(
  trajectory: AgentTrajectory,
  maxChars = 160,
): string {
  const lines: string[] = [];

  function emitNode(node: AgentTrajectory): void {
    const pad = '  '.repeat(node.depth);
    lines.push(
      `${pad}[depth ${node.depth}] ${node.agentId} -- ${clip(node.task, maxChars)}`,
    );
    for (const step of node.steps) emitStep(step, pad);
  }

  function emitStep(step: TrajectoryStep, pad: string): void {
    if ('role' in step) {
      if (step.role === 'user') {
        lines.push(`${pad}  > ${clip(blocksToText(step.content), maxChars)}`);
      } else {
        // system: the base prompt / tool declarations the model was offered
        const tools = (step.toolsAdded ?? []).map((tool) => tool.name);
        const what =
          tools.length > 0
            ? `tools: ${tools.join(', ')}`
            : clip(blocksToText(step.content), maxChars);
        lines.push(`${pad}  [system] ${what}`);
      }
    } else if (step.type === 'text') {
      lines.push(`${pad}  ${clip(step.text, maxChars)}`);
    } else if (step.type === 'thinking') {
      lines.push(`${pad}  ~ thinking: ${clip(step.thinking, maxChars)}`);
    } else {
      const flag = step.isError ? ' (error)' : '';
      lines.push(
        `${pad}  [tool ${step.name}${flag}] ${clip(step.result, maxChars)}`,
      );
      if (step.child) emitNode(step.child);
    }
  }

  emitNode(trajectory);
  return lines.join('\n');
}

function blocksToText(
  content: string | ReadonlyArray<{ type: string; text?: string }>,
): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n')
    .trim();
}

function clip(text: string, maxChars: number): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > maxChars ? `${one.slice(0, maxChars - 1)}…` : one;
}
