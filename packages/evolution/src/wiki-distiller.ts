import type { ModelCall } from './ports.ts';
import type { DistilledRun } from './trajectory-distiller.ts';
import type { Ref } from './types.ts';
import type { Culprit, WikiRow, WikiRowKind } from './wiki-types.ts';

/**
 * The wiki's LLM agent. Takes the distilled run responses plus the rows the
 * wiki already holds and produces structured wiki rows — searching across
 * runs for patterns, lessons, and failure reasons rather than relaying each
 * observation verbatim.
 */
export interface WikiAgent {
  distill(
    responses: readonly DistilledRun[],
    priorRows: readonly WikiRow[],
  ): Promise<WikiRow[]>;
}

/**
 * The framework's default wiki agent: builds and maintains the wiki prompt
 * (prior rows + responses in, structured rows out), calls the client's raw
 * model seam, and validates the response. The client never writes this
 * prompt — it only supplies the `ModelCall`.
 */
export class PromptedWikiAgent implements WikiAgent {
  constructor(private readonly model: ModelCall) {}

  async distill(
    responses: readonly DistilledRun[],
    priorRows: readonly WikiRow[],
  ): Promise<WikiRow[]> {
    const output = await this.model.complete(wikiPrompt(responses, priorRows));
    return parseRows(output, responses);
  }
}

/** The framework-maintained wiki prompt. */
function wikiPrompt(
  responses: readonly DistilledRun[],
  priorRows: readonly WikiRow[],
): string {
  const prior = priorRows
    .map(
      (row) =>
        `${row.id} ${row.kind}: ${row.content}${
          row.culprit ? ` [culprit ${row.culprit.ref}]` : ''
        }`,
    )
    .join('\n');
  const runs = responses
    .map((response) => {
      const contexts = response.view.contexts
        .map((c) => `${c.id} (${c.kind})`)
        .join(', ');
      const entries = response.entries
        .map((e) => `${e.kind}: ${e.content}`)
        .join('\n');
      return `run ${response.view.runId} -- task: ${response.view.task}\nrendered contexts: ${contexts || '(none)'}\nobservations:\n${entries || '(none)'}`;
    })
    .join('\n\n');
  return [
    'You are the wiki agent of a self-improving agent system.',
    'Turn the distilled run responses into structured wiki rows, searching',
    'across runs (and the existing wiki) for patterns, lessons, failure',
    'reasons, and strategies — generalize, do not relay observations verbatim.',
    '',
    'Rules:',
    '- Grounded only: every row quotes or faithfully condenses the responses; never invent facts.',
    '- kind is one of: strategy, pattern, failure, lesson, human_response, back_pressure, patch_hypothesis.',
    '- polarity is positive or negative, for strategy/failure rows.',
    '- runId must be one of the response run ids.',
    '- culprit only when a row is attributable to one rendered context:',
    '  role is one of introducer, propagator, missed_detector;',
    '  kind is one of tool, skill, agent; ref must be a context that run rendered.',
    '- Return ONLY a JSON array of rows, no prose. Empty array if nothing is worth keeping.',
    '',
    'Existing wiki rows:',
    prior || '(empty)',
    'Distilled run responses:',
    runs || '(none)',
  ].join('\n');
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

/** Parses and validates the model's response; malformed output throws. */
function parseRows(
  output: string,
  responses: readonly DistilledRun[],
): WikiRow[] {
  const candidates = JSON.parse(extractArray(output)) as unknown;
  if (!Array.isArray(candidates))
    throw new Error('Wiki agent model output was not a JSON array.');
  const byRun = new Map(responses.map((r) => [r.view.runId, r]));
  const now = Date.now();
  const rows: WikiRow[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const c = candidate as {
      kind?: unknown;
      polarity?: unknown;
      runId?: unknown;
      content?: unknown;
      culprit?: { role?: unknown; kind?: unknown; ref?: unknown };
    };
    if (
      typeof c.kind !== 'string' ||
      !ROW_KINDS.includes(c.kind as WikiRowKind) ||
      typeof c.content !== 'string' ||
      c.content.length === 0 ||
      typeof c.runId !== 'string' ||
      !byRun.has(c.runId)
    )
      continue;
    const response = byRun.get(c.runId) as DistilledRun;
    const rendered = new Set(response.view.contexts.map((ctx) => ctx.id));
    const row: WikiRow = {
      id: `${c.runId}:${rows.length}`,
      runId: c.runId,
      kind: c.kind as WikiRowKind,
      author: { kind: 'agent', agentId: c.runId },
      refs: {},
      content: c.content,
      useCount: 0,
      lastUsedAt: now,
      createdAt: now,
    };
    if (c.polarity === 'positive' || c.polarity === 'negative')
      row.polarity = c.polarity;
    const culprit = validCulprit(c.culprit, rendered);
    if (culprit) row.culprit = culprit;
    rows.push(row);
  }
  return rows;
}

function validCulprit(
  culprit: { role?: unknown; kind?: unknown; ref?: unknown } | undefined,
  rendered: Set<Ref>,
): Culprit | undefined {
  if (!culprit || typeof culprit.ref !== 'string') return undefined;
  if (!rendered.has(culprit.ref)) return undefined; // that run never rendered it
  if (
    typeof culprit.role !== 'string' ||
    !['introducer', 'propagator', 'missed_detector'].includes(culprit.role) ||
    typeof culprit.kind !== 'string' ||
    !['tool', 'skill', 'agent'].includes(culprit.kind)
  )
    return undefined;
  return culprit as Culprit;
}

function extractArray(output: string): string {
  const trimmed = output.trim();
  if (trimmed.startsWith('[')) return trimmed;
  const first = trimmed.indexOf('[');
  const last = trimmed.lastIndexOf(']');
  if (first === -1 || last < first)
    throw new Error('Wiki agent model output contained no JSON array.');
  return trimmed.slice(first, last + 1);
}
