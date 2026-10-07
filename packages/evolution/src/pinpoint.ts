import type { TrajectoryQuery } from './ports.ts';
import type { ContextRegistry } from './store/context-registry.ts';
import type {
  ContextKind,
  Ref,
  TaskEvent,
  TranscriptRecord,
  TranscriptRole,
} from './types.ts';
import type { Blame, Culprit, FailureLocation } from './wiki-types.ts';

/**
 * Deterministic, graph-aware blame. Given a grounded fact (a string that
 * appears in a transcript record), derives which context introduced it, how it
 * propagated, and who should have caught it. No model judgment — a pure
 * function of the trajectory and the context registry.
 */
export interface Pinpointer {
  pinpoint(fact: string): Blame | null;
  pinpointRecord(recordRef: Ref): Blame | null;
  locate(fact: string): FailureLocation | null;
  locateRecord(recordRef: Ref): FailureLocation | null;
}

/** Compact wiki-row culprit from a resolved blame. */
export function toCulprit(blame: Blame): Culprit {
  return {
    role: blame.role,
    kind: blame.culpritKind ?? 'agent',
    ref: blame.culpritContextId,
  };
}

/** Wiki-safe structured location from a resolved blame. */
export function toLocation(blame: Blame, fact: string): FailureLocation {
  return {
    fact,
    culprit: toCulprit(blame),
    introducedBy: blame.introducedBy,
    propagators: blame.propagators,
    ancestors: blame.ancestors,
    missedDetectors: blame.missedDetectors,
    dependents: blame.dependents,
  };
}

interface IntroducedBy {
  role: TranscriptRole;
  recordId: Ref;
  contextId?: Ref;
}

export class DefaultPinpointer implements Pinpointer {
  constructor(
    private readonly trajectory: TrajectoryQuery,
    private readonly registry: ContextRegistry,
  ) {}

  pinpoint(fact: string): Blame | null {
    if (!fact) return null;

    const base = this.trajectory.firstIntroduction(fact);
    if (!base) return null;

    const { kind, contextId } = base.introducedBy
      ? this.descend(base.introducedBy, base.culprit)
      : { kind: 'agent' as ContextKind, contextId: undefined };

    return {
      ...base,
      culpritKind: kind,
      culpritContextId: contextId,
      ancestors: this.trajectory.ancestors(base.culprit.id),
      missedDetectors: this.missedDetectors(fact),
      dependents: contextId ? this.registry.dependents(contextId) : [],
    };
  }

  /** Resolve a record ref to its content, then pinpoint that grounded fact. */
  pinpointRecord(recordRef: Ref): Blame | null {
    const record = this.recordById(recordRef);
    return record ? this.pinpoint(record.content) : null;
  }

  locate(fact: string): FailureLocation | null {
    const blame = this.pinpoint(fact);
    return blame ? toLocation(blame, fact) : null;
  }

  locateRecord(recordRef: Ref): FailureLocation | null {
    const record = this.recordById(recordRef);
    return record ? this.locate(record.content) : null;
  }

  /** Tool vs. context descent: which context kind introduced the fact. */
  private descend(
    introducedBy: IntroducedBy,
    task: TaskEvent,
  ): { kind: ContextKind; contextId?: Ref } {
    if (introducedBy.role === 'tool_result') {
      // The record names the tool context that produced it.
      if (introducedBy.contextId) {
        return { kind: 'tool', contextId: introducedBy.contextId };
      }
      // ponytail: legacy records without a context link fall back to the first
      // tool used — ambiguous for multi-tool tasks.
      const tool = task.contextsUsed.find(
        (u) => this.registry.get(u.contextId)?.kind === 'tool',
      );
      return { kind: 'tool', contextId: tool?.contextId };
    }
    if (introducedBy.role === 'context_injection') {
      const usage = task.contextsUsed.find(
        (u) => u.recordRef === introducedBy.recordId,
      );
      const context = usage ? this.registry.get(usage.contextId) : undefined;
      // Unregistered context — can't be blamed or patched.
      return context
        ? { kind: context.kind, contextId: context.id }
        : { kind: 'agent' };
    }
    return { kind: 'agent' };
  }

  /** Validation/evaluation tasks that consumed the fact and still passed. */
  private missedDetectors(fact: string): Ref[] {
    const carrying = new Set<Ref>();
    for (const record of this.trajectory.records()) {
      if (record.content.includes(fact)) carrying.add(record.id);
    }
    const out: Ref[] = [];
    for (const task of this.allTasks()) {
      if (
        (task.kind === 'validation' || task.kind === 'evaluation') &&
        task.status === 'done' &&
        task.inputRefs.some((ref) => carrying.has(ref))
      ) {
        out.push(task.id);
      }
    }
    return out;
  }

  /** Every task in the trajectory, rooted at top-level runs. */
  private allTasks(): TaskEvent[] {
    const out: TaskEvent[] = [];
    const stack = [...this.trajectory.runs()];
    for (let i = 0; i < stack.length; i++) {
      out.push(stack[i]);
      stack.push(...this.trajectory.children(stack[i].id));
    }
    return out;
  }

  private recordById(ref: Ref): TranscriptRecord | undefined {
    return this.trajectory.records().find((r) => r.id === ref);
  }
}
