import type { Ref, TaskEvent, TranscriptRecord } from './types.ts';
import type { Blame, Introduction, WikiRow } from './wiki-types.ts';

/**
 * The seams of the evolution framework. Everything depends on these, nothing
 * depends on an implementation. Implementations (in-memory, SQLite, substrate
 * adapters) plug in behind them.
 */

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
