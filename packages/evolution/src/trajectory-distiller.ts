import type { ModelCall } from './ports.ts';
import {
  allRuns,
  type RenderedContext,
  renderedContexts,
  type StepKind,
  stepKind,
  stepText,
  type Trajectory,
  walkTrajectory,
} from './trajectory.ts';
import type { Ref } from './types.ts';
import type { Culprit } from './wiki-types.ts';

/** One compact, lossless step of the distilled view. */
export interface ViewStep {
  ref: Ref;
  /** The run (agent id) that produced the step. */
  agentId: Ref;
  kind: StepKind;
  /** The step's searchable text: user/system text, answer, thinking, tool result. */
  text: string;
  /** Tool identity, for tool steps (name, call arguments, error flag). */
  tool?: { name: string; arguments: string; isError: boolean };
}

/** Structural edges the traditional code derives — never invented. */
export type ViewEdgeKind = 'spawned' | 'used';

/** One derived edge: `from` → `to`. */
export interface ViewEdge {
  from: Ref;
  to: Ref;
  kind: ViewEdgeKind;
}

/**
 * The smaller view of one run — every step and rendered context retained
 * (nothing dropped from the trajectory, only provider noise left behind),
 * with the structural relations the raw step list leaves implicit
 * (ownership and context usage) made explicit as edges.
 */
export interface RunView {
  /** The run's root agent id. */
  runId: Ref;
  task: string;
  /** Every context rendered anywhere in the run, deduplicated by id. */
  contexts: RenderedContext[];
  steps: ViewStep[];
  edges: ViewEdge[];
}

/** A grounded observation the LLM attached to the view. */
export interface DistilledEntry {
  kind: DistilledKind;
  polarity?: 'positive' | 'negative';
  /** Grounded content — quotes the view, never invents facts. */
  content: string;
  culprit?: Culprit;
  /** The view step the observation grounds on, when one is named. */
  stepRef?: Ref;
}

/** What the run-level LLM may observe; the wiki agent re-structures further. */
export type DistilledKind =
  | 'strategy'
  | 'pattern'
  | 'failure'
  | 'lesson'
  | 'human_response'
  | 'back_pressure'
  | 'patch_hypothesis';

/** One distilled run — the compact view plus the LLM's observations. */
export interface DistilledRun {
  view: RunView;
  entries: DistilledEntry[];
}

/** The LLM half of the distiller: observes one compact view, returns grounded
 * entries. The framework owns the prompt; the client supplies the `ModelCall`. */
export interface Judger {
  distill(view: RunView): Promise<DistilledEntry[]>;
}

export interface TrajectoryDistiller {
  distill(trajectory: Trajectory): Promise<DistilledRun>;
}

/**
 * The whole distiller: traditional code reduces the trajectory to the compact
 * lossless view (steps + edges), then the LLM observes it. What leaves is
 * smaller than the trajectory but loses nothing the wiki needs.
 */
export class DefaultTrajectoryDistiller implements TrajectoryDistiller {
  constructor(private readonly judger: Judger) {}

  async distill(trajectory: Trajectory): Promise<DistilledRun> {
    const view = buildRunView(trajectory);
    return { view, entries: await this.judger.distill(view) };
  }
}

/** Pure projection: the trajectory → the compact view with explicit edges. */
export function buildRunView(trajectory: Trajectory): RunView {
  const contexts = new Map<Ref, RenderedContext>();
  const edges: ViewEdge[] = [];
  for (const run of allRuns(trajectory)) {
    for (const context of renderedContexts(run)) {
      if (!contexts.has(context.id)) contexts.set(context.id, context);
      if (context.kind === 'tool')
        edges.push({ from: run.agentId, to: context.id, kind: 'used' });
    }
    for (const step of run.steps)
      if ('type' in step && step.type === 'toolCall' && step.child)
        edges.push({ from: step.id, to: step.child.agentId, kind: 'spawned' });
  }

  return {
    runId: trajectory.agentId,
    task: trajectory.task,
    contexts: [...contexts.values()],
    steps: walkTrajectory(trajectory).map((entry) => ({
      ref: entry.ref,
      agentId: entry.run.agentId,
      kind: stepKind(entry.step),
      text: stepText(entry.step),
      tool:
        'type' in entry.step && entry.step.type === 'toolCall'
          ? {
              name: entry.step.name,
              arguments: JSON.stringify(entry.step.arguments),
              isError: entry.step.isError,
            }
          : undefined,
    })),
    edges,
  };
}

/**
 * The framework's default Judger: builds and maintains the observing prompt,
 * calls the client's raw model seam, and validates the response. The client
 * never writes this prompt — it only supplies the `ModelCall`.
 */
export class PromptedJudger implements Judger {
  constructor(private readonly model: ModelCall) {}

  async distill(view: RunView): Promise<DistilledEntry[]> {
    const output = await this.model.complete(observingPrompt(view));
    return parseEntries(output, view);
  }
}

/** The framework-maintained observing prompt over one run's view. */
function observingPrompt(view: RunView): string {
  const contexts = view.contexts
    .map((c) => `${c.id} (${c.kind}): ${c.content}`)
    .join('\n');
  const steps = view.steps
    .map((s) => `${s.ref} ${s.agentId} ${s.kind}: ${s.text}`)
    .join('\n');
  const edges = view.edges
    .map((e) => `${e.from} --${e.kind}--> ${e.to}`)
    .join('\n');
  return [
    'You are the observation component of a self-improving agent system.',
    'Observe the following run view and distill it into grounded observations.',
    '',
    'Rules:',
    "- Grounded only: each observation's content quotes the view verbatim; never invent facts.",
    '- kind is one of: strategy, pattern, failure, lesson, human_response, back_pressure, patch_hypothesis.',
    '- polarity is positive or negative, for strategy/failure observations.',
    '- culprit only when an observation is attributable to one rendered context:',
    '  role is one of introducer, propagator, missed_detector;',
    '  kind is one of tool, skill, agent; ref must be one of the rendered context ids.',
    '- stepRef must be one of the view step refs, when an observation names its step.',
    '- Return ONLY a JSON array of observations, no prose. Empty array if nothing is worth recording.',
    '',
    'Rendered contexts:',
    contexts || '(none)',
    'Steps:',
    steps || '(none)',
    'Edges:',
    edges || '(none)',
  ].join('\n');
  // ponytail: one prompt per run, untruncated — window or stream the view if
  // real runs ever outgrow a single model call.
}

const ENTRY_KINDS: readonly DistilledKind[] = [
  'strategy',
  'pattern',
  'failure',
  'lesson',
  'human_response',
  'back_pressure',
  'patch_hypothesis',
];
const ROLES: readonly Culprit['role'][] = [
  'introducer',
  'propagator',
  'missed_detector',
];

/** Parses and validates the model's response; malformed output throws. */
function parseEntries(output: string, view: RunView): DistilledEntry[] {
  const candidates = JSON.parse(extractArray(output)) as unknown;
  if (!Array.isArray(candidates))
    throw new Error('Judger model output was not a JSON array.');
  const rendered = new Set(view.contexts.map((c) => c.id));
  const stepRefs = new Set(view.steps.map((s) => s.ref));
  const entries: DistilledEntry[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const c = candidate as {
      kind?: unknown;
      polarity?: unknown;
      content?: unknown;
      culprit?: { role?: unknown; kind?: unknown; ref?: unknown };
      stepRef?: unknown;
    };
    if (
      typeof c.kind !== 'string' ||
      !ENTRY_KINDS.includes(c.kind as DistilledKind) ||
      typeof c.content !== 'string' ||
      c.content.length === 0
    )
      continue;
    const entry: DistilledEntry = {
      kind: c.kind as DistilledKind,
      content: c.content,
    };
    if (c.polarity === 'positive' || c.polarity === 'negative')
      entry.polarity = c.polarity;
    const culprit = validCulprit(c.culprit, rendered);
    if (culprit) entry.culprit = culprit;
    if (typeof c.stepRef === 'string' && stepRefs.has(c.stepRef))
      entry.stepRef = c.stepRef;
    entries.push(entry);
  }
  return entries;
}

function validCulprit(
  culprit: { role?: unknown; kind?: unknown; ref?: unknown } | undefined,
  rendered: Set<Ref>,
): Culprit | undefined {
  if (!culprit || typeof culprit.ref !== 'string') return undefined;
  if (!rendered.has(culprit.ref)) return undefined; // not a rendered context
  if (
    typeof culprit.role !== 'string' ||
    !ROLES.includes(culprit.role as Culprit['role']) ||
    typeof culprit.kind !== 'string' ||
    !['tool', 'skill', 'agent'].includes(culprit.kind)
  )
    return undefined;
  return {
    role: culprit.role as Culprit['role'],
    kind: culprit.kind as Culprit['kind'],
    ref: culprit.ref,
  };
}

function extractArray(output: string): string {
  const trimmed = output.trim();
  if (trimmed.startsWith('[')) return trimmed;
  const first = trimmed.indexOf('[');
  const last = trimmed.lastIndexOf(']');
  if (first === -1 || last < first)
    throw new Error('Judger model output contained no JSON array.');
  return trimmed.slice(first, last + 1);
}
