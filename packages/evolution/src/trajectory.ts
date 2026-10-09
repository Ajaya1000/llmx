import type { ContextKind, Ref } from './types.ts';

/**
 * The trajectory model — what one agent run looked like from the model's
 * side, as a step tree. Structurally compatible with an executor's step
 * view: any runtime that produces these shapes satisfies it. This package
 * never imports an executor — the shapes are declared here, once, and stay
 * ours. The raw transcript stays with the producing runtime; the ordered
 * step view is the lossless unit evolution consumes.
 */

/** A JSON object value — opaque to evolution beyond being JSON. */
export type JsonObject = { readonly [key: string]: unknown };

/** A tool exactly as the model was offered it — its declaration. */
export interface ToolDescription {
  name: string;
  description: string;
  /** The tool's parameter schema (typebox / JSON); opaque to evolution. */
  parameters: unknown;
}

/** The resolved model-side context one agent ran with — the "tools given" record. */
export interface RunContext {
  model?: { provider: string; modelId: string };
  /** Every tool offered to the model, in offer order. */
  tools: readonly ToolDescription[];
  /** The agent's instructions (system prompt text), when set. */
  instructions?: string;
}

/** Any content block; only `text` blocks carry searchable text. */
export interface ContentBlock {
  type: string;
  text?: string;
}

/** One recorded step of a run, in order — the unit every derivation reads. */
export type TrajectoryStep =
  | {
      role: 'system';
      content: string | readonly ContentBlock[];
      /** Tools that became available at this point (mid-run additions). */
      toolsAdded?: readonly ToolDescription[];
    }
  | { role: 'user'; content: string | readonly ContentBlock[] }
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | {
      type: 'toolCall';
      id: string;
      name: string;
      arguments: JsonObject;
      /** The executed tool's result text. */
      result: string;
      isError: boolean;
      /** The spawned agent's full trajectory, when this step spawned a child. */
      child?: Trajectory;
    };

/** Everything one agent did in its run — the node unit of the trajectory tree. */
export interface Trajectory {
  /** Who ran — the producer of every step in this node (the agent context ref). */
  agentId: Ref;
  task: string;
  /** 0 for the entry agent; parent depth + 1 for spawned agents. */
  depth: number;
  /** The model-side context this agent ran with. */
  context: RunContext;
  /** The ordered, lossless step view. */
  steps: readonly TrajectoryStep[];
}

/** The coarse kind of a step — the distiller's view and pinpointing share it. */
export type StepKind = 'user' | 'system' | 'text' | 'thinking' | 'tool';

/** The kind of one step. */
export function stepKind(step: TrajectoryStep): StepKind {
  if ('role' in step) return step.role === 'system' ? 'system' : 'user';
  if (step.type === 'text') return 'text';
  if (step.type === 'thinking') return 'thinking';
  return 'tool';
}

/** Stable ref for a step: tool calls keep their call id, others take their
 * position (`agentId:index`). Every derived edge hangs off these. */
export function stepRef(run: Trajectory, index: number): Ref {
  const step = run.steps[index];
  return step && 'type' in step && step.type === 'toolCall'
    ? step.id
    : `${run.agentId}:${index}`;
}

/** A context as actually rendered into one run — what the model was shown. */
export interface RenderedContext {
  id: Ref;
  kind: ContextKind;
  content: string;
}

/** The contexts one run rendered: the agent's own instructions plus every
 * tool offered to it (run context + mid-run additions). */
export function renderedContexts(run: Trajectory): RenderedContext[] {
  const out: RenderedContext[] = [
    {
      id: run.agentId,
      kind: 'agent',
      content: run.context.instructions ?? '',
    },
  ];
  for (const tool of toolsOffered(run))
    out.push({
      id: toolRef(tool.name),
      kind: 'tool',
      content: tool.description,
    });
  return out;
}

/** A step met while walking the tree, with its producing run and ownership chain. */
export interface TrajectoryEntry {
  /** The run whose steps produced this step. */
  run: Trajectory;
  /** Ancestor agent ids of `run`, nearest parent first. */
  ancestors: readonly Ref[];
  /** The step itself. */
  step: TrajectoryStep;
  /** Stable ref of the step (see `stepRef`). */
  ref: Ref;
  /** The step's position within its run. */
  index: number;
}

/**
 * Pre-order walk of the trajectory tree: a run's steps in order, each
 * spawned child expanded right after its spawn step. This is the
 * chronological analog of record insertion order — the order fact matching
 * (`firstIntroduction`) trusts.
 */
export function walkTrajectory(root: Trajectory): TrajectoryEntry[] {
  const entries: TrajectoryEntry[] = [];
  const walk = (run: Trajectory, ancestors: readonly Ref[]): void => {
    run.steps.forEach((step, index) => {
      entries.push({ run, ancestors, step, ref: stepRef(run, index), index });
      if ('type' in step && step.type === 'toolCall' && step.child)
        walk(step.child, [run.agentId, ...ancestors]);
    });
  };
  walk(root, []);
  return entries;
}

/**
 * The searchable text of one step: user/system text, assistant text,
 * thinking, and tool results — the facts a run actually produced or consumed.
 */
export function stepText(step: TrajectoryStep): string {
  if ('role' in step) return blocksToText(step.content);
  if (step.type === 'text') return step.text;
  if (step.type === 'thinking') return step.thinking;
  return step.result;
}

/** Every run node in the tree, root first, then per spawn order. */
export function allRuns(root: Trajectory): Trajectory[] {
  const runs: Trajectory[] = [root];
  for (const step of root.steps)
    if ('type' in step && step.type === 'toolCall' && step.child)
      runs.push(...allRuns(step.child));
  return runs;
}

/** Every tool offered during the run: the run context plus mid-run
 * additions, deduplicated by name — first offer wins. */
export function toolsOffered(run: Trajectory): ToolDescription[] {
  const byName = new Map<string, ToolDescription>();
  for (const tool of run.context.tools) byName.set(tool.name, tool);
  for (const step of run.steps)
    if ('role' in step && step.role === 'system' && step.toolsAdded)
      for (const tool of step.toolsAdded)
        if (!byName.has(tool.name)) byName.set(tool.name, tool);
  return [...byName.values()];
}

/** Context ref for a tool, by the id convention (`tool:<name>`; agents are
 * their own ref — the `agentId`). */
export function toolRef(name: string): Ref {
  return `tool:${name}`;
}

function blocksToText(content: string | readonly ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n')
    .trim();
}
