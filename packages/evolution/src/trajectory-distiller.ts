import type { ModelCall, TrajectoryQuery } from './ports.ts';
import type { Ref, TaskEvent, TranscriptRecord } from './types.ts';
import type { Culprit, WikiRow, WikiRowKind } from './wiki-types.ts';

/** One run: a top-level task plus its subtree tasks and transcript. */
export interface Run {
  root: TaskEvent;
  tasks: TaskEvent[];
  records: TranscriptRecord[];
}

/** A distilled judgment before it becomes a wiki row. */
export interface DistilledEntry {
  kind: WikiRowKind;
  polarity?: 'positive' | 'negative';
  content: string;
  culprit?: Culprit;
  blamedRef?: Ref;
}

/**
 * Model judgment seam — turns one run into distilled entries. The default
 * implementation is the framework-owned `PromptedJudger`; clients override
 * only for tests or fully custom judgment protocols.
 */
export interface Judger {
  distill(run: Run): Promise<DistilledEntry[]>;
}

/** The distiller's output — the input to WikiMaintainer. */
export interface DistilledLog {
  rows: WikiRow[];
}

export interface TrajectoryDistiller {
  distill(trajectory: TrajectoryQuery): Promise<DistilledLog>;
}

/**
 * Samples runs (top-level tasks) and turns each into wiki rows via the
 * injected Judger. Keyed by context subgraph through `culprit.ref` — the
 * registry's `subgraph()` resolves the blast radius downstream.
 */
export class DefaultTrajectoryDistiller implements TrajectoryDistiller {
  constructor(private readonly judger: Judger) {}

  async distill(trajectory: TrajectoryQuery): Promise<DistilledLog> {
    const rows: WikiRow[] = [];
    const allRecords = trajectory.records();
    const now = Date.now();

    for (const root of trajectory.runs()) {
      const tasks: TaskEvent[] = [];
      const taskIds = new Set<Ref>([root.id]);
      const stack: Ref[] = [root.id];
      for (let i = 0; i < stack.length; i++) {
        for (const child of trajectory.children(stack[i])) {
          tasks.push(child);
          taskIds.add(child.id);
          stack.push(child.id);
        }
      }

      const run: Run = {
        root,
        tasks,
        records: allRecords.filter((r) => taskIds.has(r.taskId)),
      };

      // Sequential: row order (and ids) must follow run order.
      // ponytail: judge runs in parallel if model latency ever matters.
      const entries = await this.judger.distill(run);
      entries.forEach((entry, i) => {
        rows.push({
          id: `${root.id}:${i}`,
          missionId: root.id,
          kind: entry.kind,
          polarity: entry.polarity,
          author: { kind: 'task', taskId: root.id },
          refs: { blamedRef: entry.blamedRef, taskId: root.id },
          culprit: entry.culprit,
          content: entry.content,
          useCount: 0,
          lastUsedAt: now,
          createdAt: now,
        });
      });
    }
    return { rows };
  }
}

const ROW_KINDS: readonly WikiRowKind[] = [
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
// ponytail: 200 records / 4000 chars per record caps the prompt; stream or
// window the transcript if real runs outgrow this.
const MAX_RECORDS = 200;
const MAX_RECORD_CHARS = 4000;

/**
 * The framework's default Judger: builds and maintains the judging prompt,
 * calls the client's raw model seam, and validates the response. The client
 * never writes this prompt — it only supplies the `ModelCall`.
 */
export class PromptedJudger implements Judger {
  constructor(private readonly model: ModelCall) {}

  async distill(run: Run): Promise<DistilledEntry[]> {
    const output = await this.model.complete(judgingPrompt(run));
    return parseJudgments(output, run);
  }
}

/** The framework-maintained judging prompt over one run. */
function judgingPrompt(run: Run): string {
  const contexts = renderedContexts(run);
  const transcript = run.records
    .slice(0, MAX_RECORDS)
    .map((r) => `${r.role}: ${truncate(r.content)}`)
    .join('\n');
  return [
    'You are the judgment component of a self-improving agent system.',
    'Judge the following recorded run and distill it into judgments.',
    '',
    'Rules:',
    "- Grounded only: each judgment's content quotes the transcript verbatim; never invent facts.",
    '- kind is one of: strategy, pattern, failure, lesson, human_response, back_pressure, patch_hypothesis.',
    '- polarity is positive or negative, for strategy/failure judgments.',
    '- culprit only when a judgment is attributable to one rendered context:',
    '  role is one of introducer, propagator, missed_detector;',
    '  kind is one of tool, skill, agent; ref must be one of the rendered context ids.',
    '- Return ONLY a JSON array of judgments, no prose. Empty array if nothing is worth recording.',
    '',
    `Rendered contexts: ${contexts.join(', ') || '(none)'}`,
    `Task status: ${run.root.status}`,
    'Transcript:',
    transcript,
  ].join('\n');
}

/** Context ids rendered anywhere in the run (root + subtree). */
function renderedContexts(run: Run): Ref[] {
  return [
    ...new Set(
      [run.root, ...run.tasks].flatMap((t) =>
        t.contextsUsed.map((u) => u.contextId),
      ),
    ),
  ];
}

function truncate(content: string): string {
  return content.length <= MAX_RECORD_CHARS
    ? content
    : `${content.slice(0, MAX_RECORD_CHARS)}…`;
}

/** Parses and validates the model's response; malformed output throws. */
function parseJudgments(output: string, run: Run): DistilledEntry[] {
  const candidates = JSON.parse(extractArray(output)) as unknown;
  if (!Array.isArray(candidates))
    throw new Error('Judger model output was not a JSON array.');
  const rendered = new Set(renderedContexts(run));
  const entries: DistilledEntry[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const c = candidate as {
      kind?: unknown;
      polarity?: unknown;
      content?: unknown;
      culprit?: {
        role?: unknown;
        kind?: unknown;
        ref?: unknown;
      };
    };
    if (
      typeof c.kind !== 'string' ||
      !ROW_KINDS.includes(c.kind as WikiRowKind) ||
      typeof c.content !== 'string' ||
      c.content.length === 0
    )
      continue;
    const entry: DistilledEntry = {
      kind: c.kind as WikiRowKind,
      content: c.content,
    };
    if (c.polarity === 'positive' || c.polarity === 'negative')
      entry.polarity = c.polarity;
    const culprit = validCulprit(c.culprit, rendered);
    if (culprit) entry.culprit = culprit;
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
