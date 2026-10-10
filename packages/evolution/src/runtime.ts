import type OpenAI from 'openai';
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
import { modelFromOpenAI } from './model/completion.ts';
import { DefaultPinpointer } from './pinpoint.ts';
import type { ContextStore, ModelCall, WikiPort } from './ports.ts';
import { DefaultPatchProposer } from './proposer.ts';
import type { ApprovedPatch } from './store/approved-patches.ts';
import { InMemoryContextRegistry } from './store/context-registry.ts';
import { DefaultWikiMaintainer } from './store/wiki.ts';
import {
  InMemoryWikiPersistence,
  type WikiPersistence,
} from './store/wiki-persistence.ts';
import type { Trajectory } from './trajectory.ts';
import { allRuns, renderedContexts } from './trajectory.ts';
import {
  DefaultTrajectoryDistiller,
  type Judger,
  PromptedJudger,
} from './trajectory-distiller.ts';
import { DefaultVerifier, type RunRunner } from './verifier.ts';
import { DefaultVerifierDistiller } from './verifier-distiller.ts';
import { PromptedWikiAgent, type WikiAgent } from './wiki-distiller.ts';
import type { Verdict, WikiRow } from './wiki-types.ts';

/**
 * The composition root — the whole integration surface. The client provides
 * one recorded run: its trajectory (the step tree, structurally whatever the
 * client's executor produced) plus the context store (definitions, read &
 * write) and a raw model call. The distiller reduces the trajectory to a
 * compact lossless view, the wiki agent turns responses into structured
 * rows, and the wiki — persisted across runs — accumulates the knowledge.
 *
 * What the client still writes (its one module addition): the model/harness
 * seams — a raw `ModelCall` (prompt in, text out; the framework owns every
 * prompt: observing, the wiki agent's, judging) and a `RunRunner` (forked
 * validation runs) — and the context store. Two supported lifecycles, one
 * instance: **offline** — create per finished run, `maintain()` then `run()`;
 * **realtime** — `run()` mid-task, apply the approved patches, continue.
 */
export interface EvolutionOptions {
  /** The only client-owned execution input: one recorded run's trajectory. */
  readonly trajectory: Trajectory;
  /** Read & write access to all context artifacts (definitions). */
  readonly contexts: ContextStore;
  /** Raw model-call seam; the framework builds its prompts on this. */
  readonly model?: ModelCall;
  /**
   * OpenAI client; adapted to a `ModelCall` by sending each framework prompt
   * as one user chat message. Needs `openaiModel`. Takes effect only when
   * `model` is absent; `model` wins when both are given.
   */
  readonly openai?: OpenAI;
  /** Chat model name for `openai.chat.completions.create`. */
  readonly openaiModel?: string;
  /** Judger override (tests/deterministic observing); needs `wikiAgent` too
   * unless `model`/`openai` supplies the default prompted one. */
  readonly judger?: Judger;
  /** Wiki-agent override (tests/deterministic rows); needs `judger` too
   * unless `model`/`openai` supplies the default prompted one. */
  readonly wikiAgent?: WikiAgent;
  /** Harness seam: forked validation runs (patched context + evals). */
  readonly runner: RunRunner;
  /** Human gate decision for passed verdicts; default rejects everything. */
  readonly decide?: (verdict: Verdict) => GateDecision;
  /** Wiki persistence; default in-memory — pass a durable one (e.g. SQLite)
   * so the wiki accumulates knowledge across runs. */
  readonly persistence?: WikiPersistence;
  /** Patch application; default appends the patch text to the context. */
  readonly applier?: PatchApplier;
  /**
   * Source code paths the client mentions. Evolution never patches source
   * code: a context whose id is one of these paths (or lives under one as a
   * directory) is excluded from every patching phase — no eval derivation,
   * no proposal, no forked validation, no gate. Its failures still land in
   * the wiki as knowledge; blame is redirected by the wiki agent, not by
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

/** Evolution wired end-to-end from one run's trajectory. Create, `maintain()`, `run()`. */
export class Evolution {
  private readonly trajectory: Trajectory;
  private readonly registry = new InMemoryContextRegistry();
  private readonly wiki: DefaultWikiMaintainer;
  private readonly loop: DefaultEvolutionLoop;
  private readonly distiller: DefaultTrajectoryDistiller;
  private readonly wikiAgent: WikiAgent;
  private readonly deriver = new DefaultTestInstanceDeriver();
  private readonly evals = new InMemoryContextEvalStore();
  private readonly decide?: (verdict: Verdict) => GateDecision;
  private readonly applier: PatchApplier;
  private readonly contexts: ContextStore;
  /** Mentioned source code paths — their contexts are never patched. */
  private readonly sourcePaths: readonly string[];
  /** The run is distilled exactly once per instance. */
  private distilled = false;

  constructor(options: EvolutionOptions) {
    this.trajectory = options.trajectory;
    this.decide = options.decide;
    this.applier = options.applier ?? appendPatch;
    this.contexts = options.contexts;
    this.sourcePaths = options.sourcePaths ?? [];
    const model =
      options.model ?? modelFromOpenAI(options.openai, options.openaiModel);
    const judger =
      options.judger ?? (model ? new PromptedJudger(model) : undefined);
    const wikiAgent =
      options.wikiAgent ?? (model ? new PromptedWikiAgent(model) : undefined);
    if (!judger || !wikiAgent)
      throw new Error(
        'Evolution needs a model call or both a judger and a wiki agent override (model call may be `model` or `openai`).',
      );
    this.distiller = new DefaultTrajectoryDistiller(judger);
    this.wikiAgent = wikiAgent;
    this.wiki = new DefaultWikiMaintainer(
      // pinpointing is deterministic: the trajectory + context graph suffice.
      new DefaultPinpointer(options.trajectory, this.registry),
      options.persistence ?? new InMemoryWikiPersistence(),
    );
    // The loop sees the wiki through a view: only failures that have not
    // had their pass yet — that is what makes run() re-entrant instead of
    // churning the same patches every pass.
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
    this.syncContextRegistry();
  }

  /**
   * Distills this run into the wiki, once: reduces the trajectory to the
   * compact view, observes it, then has the wiki agent search the response
   * (plus the wiki's prior rows) for patterns, lessons, and failure reasons.
   * Idempotent — a second call is a no-op.
   */
  async maintain(): Promise<void> {
    if (this.distilled) return;
    this.distilled = true;
    const response = await this.distiller.distill(this.trajectory);
    const rows = await this.wikiAgent.distill([response], this.wiki.rows());
    for (const row of rows) this.wiki.record(row);
  }

  /** One full pass: maintain → eval → evolve → gate. Re-entrant. */
  async run(): Promise<EvolutionResult> {
    await this.maintain();

    // Eval: derive test instances for each failure that has not had its
    // pass yet (culprit + dependents), before any patch exists. Two
    // failures on one context derive two evals — the store dedups by input.
    for (const failure of this.wiki.prioritizedFailures()) {
      const culprit = failure.culprit?.ref;
      if (!culprit || !this.patchable(failure)) continue;
      for (const candidate of this.deriver.derive({ input: failure.content }, [
        culprit,
        ...this.registry.dependents(culprit),
      ]))
        this.evals.persist(candidate);
    }

    // Evolve: propose → forked validation → bounded retry. The failures the
    // loop is about to see are exactly the pending ones (its view applies
    // the same patchable filter); each gets its pass marked, once.
    const { verdicts, retriesUsed } = this.loop.run();

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
   * store-owned culprit that is neither source code nor a failure that
   * already had its pass.
   */
  private patchable(failure: WikiRow): boolean {
    const culprit = failure.culprit?.ref;
    return (
      culprit !== undefined &&
      this.contexts.get(culprit) !== undefined && // must be store-owned
      !this.isSource(culprit)
    );
  }

  /** A mentioned source path owns itself and everything under it. */
  private isSource(ref: string): boolean {
    return this.sourcePaths.some(
      (path) => ref === path || ref.startsWith(`${path}/`),
    );
  }

  /**
   * Syncs the context graph from both sources: definitions from the context
   * store (authoritative, re-registered on every sync — a patch written to
   * the store updates the derived form) and usage from the trajectory —
   * rendered contexts (instructions, offered tools) the store does not own
   * are still registered so the usage graph stays complete, plus the
   * agent→tool usage edges, but they are never patch targets.
   */
  private syncContextRegistry(): void {
    for (const context of this.contexts.list()) this.registry.register(context);

    for (const run of allRuns(this.trajectory)) {
      for (const context of renderedContexts(run)) {
        // usage edge: the run's agent depends on every tool it was offered
        // (its own agent context is the agent itself, not a dependency).
        if (context.id !== run.agentId)
          this.registry.observe([{ from: run.agentId, to: context.id }]);
        if (this.contexts.get(context.id) === undefined)
          this.registry.register({
            ...context,
            dependsOn: [],
          });
      }
    }
  }
}
