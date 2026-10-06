import type { TaskObserver, TrajectoryQuery } from '../ports.ts';
import type { Ref, TaskEvent, TranscriptRecord } from '../types.ts';
import type { Introduction } from '../wiki-types.ts';

/**
 * The trajectory — write tasks and records, query provenance and ownership.
 * An implementation is swappable; this file ships the in-memory one for tests.
 */
export interface TrajectoryStore extends TaskObserver, TrajectoryQuery {
  /** Admit one immutable transcript record (carries content for fact matching). */
  record(record: TranscriptRecord): void;
}

/** In-memory TrajectoryStore — ownership + provenance indexes over tasks and records. */
export class InMemoryTrajectoryStore implements TrajectoryStore {
  private tasks = new Map<Ref, TaskEvent>();
  private recordIndex = new Map<Ref, TranscriptRecord>();
  /** Record insertion order — earliest first, the firstIntroduction tiebreaker. */
  private order: Ref[] = [];

  onTask(event: TaskEvent): void {
    this.tasks.set(event.id, event);
  }

  record(record: TranscriptRecord): void {
    this.recordIndex.set(record.id, record);
    this.order.push(record.id);
  }

  /** Inputs of a task (or of the task that produced a record). */
  inputs(ref: Ref): Ref[] {
    const task = this.taskFor(ref);
    return task ? [...task.inputRefs] : [];
  }

  children(taskId: Ref): TaskEvent[] {
    const out: TaskEvent[] = [];
    for (const task of this.tasks.values()) {
      if (task.parentId === taskId) out.push(task);
    }
    return out;
  }

  /** Ownership chain upward from a task (or the task that produced a record). */
  ancestors(ref: Ref): Ref[] {
    const chain: Ref[] = [];
    let task = this.taskFor(ref);
    while (task?.parentId) {
      chain.push(task.parentId);
      task = this.tasks.get(task.parentId);
    }
    return chain;
  }

  /** Top-level tasks — one per run. */
  runs(): TaskEvent[] {
    return [...this.tasks.values()].filter((t) => !t.parentId);
  }

  records(): TranscriptRecord[] {
    return [...this.recordIndex.values()];
  }

  /**
   * The task that first introduced `fact`: the earliest record whose content
   * contains it. `propagators` lists the downstream tasks that reused it.
   */
  firstIntroduction(fact: string): Introduction | null {
    const matches: TranscriptRecord[] = [];
    for (const id of this.order) {
      const record = this.recordIndex.get(id);
      if (record?.content.includes(fact)) matches.push(record);
    }
    if (matches.length === 0) return null;

    const culprit = this.tasks.get(matches[0].taskId);
    if (!culprit) return null;

    const seen = new Set<Ref>();
    const propagators: Ref[] = [];
    for (const record of matches.slice(1)) {
      if (record.taskId !== culprit.id && !seen.has(record.taskId)) {
        seen.add(record.taskId);
        propagators.push(record.taskId);
      }
    }
    return {
      culprit,
      role: 'introducer',
      propagators,
      introducedBy: {
        recordId: matches[0].id,
        role: matches[0].role,
        contextId: matches[0].contextId,
      },
    };
  }

  private taskFor(ref: Ref): TaskEvent | undefined {
    const direct = this.tasks.get(ref);
    if (direct) return direct;
    const record = this.recordIndex.get(ref);
    return record ? this.tasks.get(record.taskId) : undefined;
  }
}
