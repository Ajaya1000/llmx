import {
  DefaultTestInstanceDeriver,
  InMemoryContextEvalStore,
} from './eval.ts';
import {
  appendPatch,
  DefaultEvolutionLoop,
  type PatchApplier,
} from './evolution-loop.ts';
import { DefaultGate, type GateDecision } from './gate.ts';
import { DefaultPinpointer } from './pinpoint.ts';
import type {
  ContextStore,
  ModelCall,
  TrajectoryQuery,
  WikiPort,
} from './ports.ts';
import { DefaultPatchProposer } from './proposer.ts';
import type { ApprovedPatch } from './store/approved-patches.ts';
import { InMemoryContextRegistry } from './store/context-registry.ts';
import type { TrajectoryStore } from './store/trajectory.ts';
import { DefaultWikiMaintainer } from './store/wiki.ts';
import {
  InMemoryWikiPersistence,
  type WikiPersistence,
} from './store/wiki-persistence.ts';
import {
  DefaultTrajectoryDistiller,
  type Judger,
  PromptedJudger,
} from './trajectory-distiller.ts';
import type { ContextEdge, ContextKind, Ref, TaskEvent } from './types.ts';
import { DefaultVerifier, type RunRunner } from './verifier.ts';
import { DefaultVerifierDistiller } from './verifier-distiller.ts';
import type { Verdict, WikiRow } from './wiki-types.ts';

/**
 * The composition root — the whole integration surface. The client provides
 * exactly one thing: the recorded trajectory. Contexts, dependencies, the
 * wiki, evals, and the loop are all derived from it; evolution drives itself.
 *
 * What the client still writes (its one module addition): the model/harness
 * seams — a raw `ModelCall` (prompt in, text out; the framework owns every
 * prompt, including judging) and a `RunRunner` (forked validation runs) —
 * and the context store (read & write access to the authoritative
 * artifacts, addressed by reference; any executor type works). Usage — what
 * context was used, when, with which dependencies — is derived from the
 * trajectory. Definitions come from the store, and gate-approved patches
 * are written back to it.
 *
 * Two supported lifecycles, one instance:
 *
 * - **Offline** — the live app records into the trajectory and calls
 *   `maintain()` as runs finish (wiki stays current, each run judged once);
 *   `run()` later evolves over the accumulated failures.
 * - **Realtime** — `run()` mid-task returns this pass's approved patches;
 *   the client applies them to the live artifacts, the task continues, and
 *   later `maintain()`/`run()` calls pick up only what is new.
 */
export interface EvolutionOptions {
  /** The only client-owned input: the recorded trajectory (usage). */
  readonly trajectory: TrajectoryStore;
  /** Read & write access to all context artifacts (definitions). */
  readonly contexts: ContextStore;
  /** Raw model-call seam; the framework builds its prompts on this. */
  readonly model?: ModelCall;
  /** Judger override (tests, fully custom judgment); default is the
   * framework-owned `PromptedJudger` over `model`. Exactly one of
   * `model` / `judger` is required. */
  readonly judger?: Judger;
  /** Harness seam: forked validation runs (patched context + evals). */
  readonly runner: RunRunner;
  /** Human gate decision for passed verdicts; default rejects everything. */
  readonly decide?: (verdict: Verdict) => GateDecision;
  /** Wiki persistence; default in-memory (lost with the process). */
  readonly persistence?: WikiPersistence;
  /** Patch application; default appends the patch text to the context. */
  readonly applier?: PatchApplier;
  /**
   * Source code paths the client mentions. Evolution never patches source
   * code: a context whose id is one of these paths (or lives under one as a
   * directory) is excluded from every patching phase — no eval derivation,
   * no proposal, no forked validation, no gate. Its failures still land in
   * the wiki as knowledge; blame is redirected by the `Judger`, not by
   * patching code.
   */
  readonly sourcePaths?: readonly string[];
}

/** What one full evolution pass produced. */
export interface EvolutionResult {
  /** Final verdict per proposed patch this pass (after bounded retries). */
  readonly verdicts: Verdict[];
  /** Patches approved this pass — each already written to the context store. */
  readonly approved: ApprovedPatch[];
  /** Retry attempts consumed across all patches this pass. */
  readonly retriesUsed: number;
}

/** Evolution wired end-to-end from a trajectory. Create, `maintain()`, `run()`. */
export class Evolution {
  private readonly trajectory: TrajectoryStore;
  private readonly registry: InMemoryContextRegistry;
  private readonly wiki: DefaultWikiMaintainer;
  private readonly loop: DefaultEvolutionLoop;
  private readonly judger: Judger;
  private readonly deriver = new DefaultTestInstanceDeriver();
  private readonly evals = new InMemoryContextEvalStore();
  private readonly decide?: (verdict: Verdict) => GateDecision;
  private readonly applier: PatchApplier;
  private readonly contexts: ContextStore;
  /** Mentioned source code paths — their contexts are never patched. */
  private readonly sourcePaths: readonly string[];
  /** Run root ids already distilled — maintain() never re-judges a run. */
  // ponytail: in-memory set; persist alongside the wiki if a long-lived
  // offline instance must survive restarts without re-judging history.
  private readonly distilledRuns = new Set<Ref>();
  /** Culprit refs already proposed in an earlier pass — never re-proposed. */
  // ponytail: same ceiling as distilledRuns; a culprit gets one pass
  // (retry budget is spent inside it) until its failure reappears fresh.
  private readonly proposed = new Set<Ref>();

  constructor(options: EvolutionOptions) {
    this.trajectory = options.trajectory;
    this.decide = options.decide;
    const judger =
      options.judger ??
      (options.model ? new PromptedJudger(options.model) : undefined);
    if (!judger)
      throw new Error('Evolution needs a model call or a judger override.');
    this.judger = judger;
    this.applier = options.applier ?? appendPatch;
    this.contexts = options.contexts;
    this.sourcePaths = options.sourcePaths ?? [];
    this.registry = new InMemoryContextRegistry();
    this.wiki = new DefaultWikiMaintainer(
      // pinpointing is deterministic: trajectory + context graph suffice.
      new DefaultPinpointer(options.trajectory, this.registry),
      options.persistence ?? new InMemoryWikiPersistence(),
    );
    // The loop sees the wiki through a view: only failures whose culprit has
    // not been proposed in an earlier pass — that is what makes run()
    // re-entrant instead of churning the same patches every pass.
    const loopWiki: WikiPort = {
      record: (row) => this.wiki.record(row),
      pinpoint: (fact) => this.wiki.pinpoint(fact),
      prioritizedFailures: (k) =>
        this.wiki
          .prioritizedFailures(k)
          .filter((failure) => this.patchable(failure)),
    };
    this.loop = new DefaultEvolutionLoop(
      loopWiki,
      new DefaultPatchProposer(this.registry),
      new DefaultVerifier(options.runner),
      this.registry,
      this.applier,
    );
    syncContextRegistry(this.registry, this.contexts, this.trajectory);
  }

  /**
   * Keeps the wiki current as the live app records: re-syncs the context
   * graph (latest rendered content per context — a patched context
   * re-rendered in a continuation run updates its derived form) and distills
   * each run exactly once. Idempotent; call it after any batch of records.
   */
  async maintain(): Promise<void> {
    syncContextRegistry(this.registry, this.contexts, this.trajectory);
    const fresh = this.trajectory
      .runs()
      .filter((run) => !this.distilledRuns.has(run.id));
    if (fresh.length === 0) return;
    for (const run of fresh) this.distilledRuns.add(run.id);
    const distiller = new DefaultTrajectoryDistiller(this.judger);
    const log = await distiller.distill(this.view(fresh));
    for (const row of log.rows) this.wiki.record(row);
  }

  /** One full pass: maintain → eval → evolve → gate. Re-entrant. */
  async run(): Promise<EvolutionResult> {
    await this.maintain();

    // Eval: derive test instances for each un-proposed failure's culprit
    // + dependents, before any patch exists.
    for (const failure of this.wiki.prioritizedFailures()) {
      const culprit = failure.culprit?.ref;
      if (!culprit || !this.patchable(failure)) continue;
      for (const candidate of this.deriver.derive({ input: failure.content }, [
        culprit,
        ...this.registry.dependents(culprit),
      ]))
        this.evals.persist(candidate);
    }

    // Evolve: propose → forked validation → bounded retry, over failures
    // whose culprit this instance has not yet proposed.
    const { verdicts, retriesUsed } = this.loop.run();
    for (const verdict of verdicts) this.proposed.add(verdict.patch.contextId);

    // Verdicts become wiki rows; passed ones reach the human gate.
    for (const row of new DefaultVerifierDistiller().distill(verdicts))
      this.wiki.record(row);
    const gate = new DefaultGate(this.decide);
    const approved: ApprovedPatch[] = [];
    for (const verdict of verdicts) {
      if (!verdict.pass || gate.review(verdict) !== 'approved') continue;
      // Participation: an approved patch is written back through the store —
      // the same reference the client's executor renders from.
      const original = this.contexts.get(verdict.patch.contextId);
      if (!original) continue; // not store-owned; patchable() filtered these
      this.contexts.write(this.applier(original, verdict.patch));
      approved.push({
        patch: verdict.patch,
        verdict,
        approvedAt: Date.now(),
      });
    }

    return { verdicts, approved, retriesUsed };
  }

  /**
   * The one patchability rule every patching phase shares (eval derivation,
   * the loop's proposal view): a failure is patchable when it names a
   * culprit that is neither source code nor already proposed.
   */
  private patchable(failure: WikiRow): boolean {
    const culprit = failure.culprit?.ref;
    return (
      culprit !== undefined &&
      this.contexts.get(culprit) !== undefined && // must be store-owned
      !this.proposed.has(culprit) &&
      !this.isSource(culprit)
    );
  }

  /** A mentioned source path owns itself and everything under it. */
  private isSource(ref: Ref): boolean {
    return this.sourcePaths.some(
      (path) => ref === path || ref.startsWith(`${path}/`),
    );
  }

  /** A trajectory query whose `runs()` yields only the given fresh runs. */
  private view(fresh: TaskEvent[]): TrajectoryQuery {
    const trajectory = this.trajectory;
    return {
      runs: () => fresh,
      children: (taskId) => trajectory.children(taskId),
      ancestors: (ref) => trajectory.ancestors(ref),
      inputs: (ref) => trajectory.inputs(ref),
      firstIntroduction: (fact) => trajectory.firstIntroduction(fact),
      records: () => trajectory.records(),
    };
  }
}

/**
 * Syncs the context graph from both sources: definitions from the context
 * store (authoritative, re-registered on every sync — a patch written to
 * the store updates the derived form), usage from the trajectory — rendered
 * contexts the store does not own are still registered (content from their
 * `context_injection` records) so the usage graph stays complete, but they
 * are never patch targets.
 */
function syncContextRegistry(
  registry: InMemoryContextRegistry,
  contexts: ContextStore,
  trajectory: TrajectoryStore,
): void {
  for (const context of contexts.list()) registry.register(context);

  const rendered = new Map<Ref, string>();
  for (const record of trajectory.records())
    if (record.role === 'context_injection' && record.contextId)
      rendered.set(record.contextId, record.content);

  const ids = new Set<Ref>();
  const edges: ContextEdge[] = [];
  const walk = (task: TaskEvent): void => {
    for (const usage of task.contextsUsed) ids.add(usage.contextId);
    edges.push(...task.contextEdges);
    for (const child of trajectory.children(task.id)) walk(child);
  };
  for (const run of trajectory.runs()) walk(run);

  for (const id of ids)
    if (contexts.get(id) === undefined)
      registry.register({
        id,
        kind: kindOf(id),
        content: rendered.get(id) ?? '',
        dependsOn: [],
      });
  registry.observe(edges);
}

/** Kind from the id prefix ("tool:x" / "skill:x"); anything else is an agent. */
function kindOf(id: Ref): ContextKind {
  return id.startsWith('tool:')
    ? 'tool'
    : id.startsWith('skill:')
      ? 'skill'
      : 'agent';
}
