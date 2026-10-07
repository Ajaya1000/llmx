import type { Context, Ref, TaskEvent, TranscriptRecord } from './types.ts';
import type { Blame, Introduction, WikiRow } from './wiki-types.ts';

/**
 * The seams of the evolution framework. Everything depends on these, nothing
 * depends on an implementation. Implementations (in-memory, SQLite, substrate
 * adapters) plug in behind them.
 */

/**
 * Read & write access to the authoritative context artifacts, addressed by
 * reference (context id). The client owns it — files, a database, or its
 * executor's own stores — so any executor type works. Usage (what context
 * was used, when, and with which dependencies) is derived from the
 * trajectory; definitions come from here, and only here.
 *
 * `write` is the only mutation path, reserved for applying gate-approved
 * patches — the framework never invents contexts or writes unprompted.
 */
export interface ContextStore {
  /** Every context — the complete artifact set, used in runs or not. */
  list(): Context[];
  /** One context by reference. */
  get(id: Ref): Context | undefined;
  /** Persist one context (an approved patch's patched form). */
  write(context: Context): void;
}

/**
 * The raw model-call seam: prompt in, completion text out. The client owns
 * only the model, transport, and cost — the framework owns every prompt
 * built on top of this (judging today; patch proposing later). This is what
 * keeps judgment prompts maintained by the framework instead of re-written
 * per client.
 */
export interface ModelCall {
  complete(prompt: string): Promise<string>;
}

/** The only write into the trajectory — emitted for every task. */
export interface TaskObserver {
  onTask(event: TaskEvent): void;
}

/** Provenance reads over the recorded tasks. */
export interface TrajectoryQuery {
  inputs(ref: Ref): Ref[];
  children(taskId: Ref): TaskEvent[];
  ancestors(ref: Ref): Ref[];
  /** First record whose content contains `fact` (earliest by insertion order). */
  firstIntroduction(fact: string): Introduction | null;
  /** Top-level tasks — one per run. */
  runs(): TaskEvent[];
  /** All transcript records. */
  records(): TranscriptRecord[];
}

/** The wiki — curated, time-framed, bounded store of distilled judgments. */
export interface WikiPort {
  record(row: WikiRow): void;
  pinpoint(fact: string): Blame | null;
  prioritizedFailures(k?: number): WikiRow[];
}
