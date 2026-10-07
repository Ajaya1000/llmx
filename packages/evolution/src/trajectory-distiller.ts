import type { TrajectoryQuery } from './ports.ts';
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

/** Model judgment seam — turns one run into distilled entries. */
export interface Judger {
  distill(run: Run): DistilledEntry[];
}

/** The distiller's output — the input to WikiMaintainer. */
export interface DistilledLog {
  rows: WikiRow[];
}

export interface TrajectoryDistiller {
  distill(trajectory: TrajectoryQuery): DistilledLog;
}

/**
 * Samples runs (top-level tasks) and turns each into wiki rows via the
 * injected Judger. Keyed by context subgraph through `culprit.ref` — the
 * registry's `subgraph()` resolves the blast radius downstream.
 */
export class DefaultTrajectoryDistiller implements TrajectoryDistiller {
  constructor(private readonly judger: Judger) {}

  distill(trajectory: TrajectoryQuery): DistilledLog {
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

      this.judger.distill(run).forEach((entry, i) => {
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
