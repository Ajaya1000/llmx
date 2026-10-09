import type { ContextRegistry } from './store/context-registry.ts';
import {
  renderedContexts,
  stepKind,
  stepText,
  type Trajectory,
  type TrajectoryEntry,
  toolRef,
  walkTrajectory,
} from './trajectory.ts';
import type { Ref } from './types.ts';
import type { Blame, Culprit, FailureLocation } from './wiki-types.ts';

/**
 * Deterministic, graph-aware blame. Given a grounded fact (a string that
 * appears in a step of the run's trajectory), derives which context
 * introduced it, how it propagated, and who should have caught it. No model
 * judgment — a pure function of the trajectory and the context registry.
 */
export interface Pinpointer {
  pinpoint(fact: string): Blame | null;
  pinpointStep(stepRef: Ref): Blame | null;
  locate(fact: string): FailureLocation | null;
  locateStep(stepRef: Ref): FailureLocation | null;
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

export class DefaultPinpointer implements Pinpointer {
  private readonly entries: readonly TrajectoryEntry[];

  constructor(
    trajectory: Trajectory,
    private readonly registry: ContextRegistry,
  ) {
    this.entries = walkTrajectory(trajectory);
  }

  pinpoint(fact: string): Blame | null {
    if (!fact) return null;

    const first = this.entries.find((entry) =>
      stepText(entry.step).includes(fact),
    );
    if (!first) return null;

    const { kind, contextId } = this.descend(first, fact);
    return {
      culprit: first.run.agentId,
      role: 'introducer',
      introducedBy: {
        stepRef: first.ref,
        kind: stepKind(first.step),
        contextId,
      },
      propagators: this.propagators(first, fact),
      culpritKind: kind,
      culpritContextId: contextId,
      ancestors: [...first.ancestors],
      missedDetectors: this.missedDetectors(first, fact),
      dependents: contextId ? this.registry.dependents(contextId) : [],
    };
  }

  /** Resolve a step ref to its text, then pinpoint that grounded fact. */
  pinpointStep(stepRef: Ref): Blame | null {
    const entry = this.entryByRef(stepRef);
    return entry ? this.pinpoint(stepText(entry.step)) : null;
  }

  locate(fact: string): FailureLocation | null {
    const blame = this.pinpoint(fact);
    return blame ? toLocation(blame, fact) : null;
  }

  locateStep(stepRef: Ref): FailureLocation | null {
    const entry = this.entryByRef(stepRef);
    return entry ? this.locate(stepText(entry.step)) : null;
  }

  /**
   * Tool vs. context descent: which context kind introduced the fact. A tool
   * result blames the tool that produced it; a system injection blames the
   * rendered context that carries the fact; everything the agent itself
   * wrote (or relayed from its user) blames the agent's own context.
   */
  private descend(
    entry: TrajectoryEntry,
    fact: string,
  ): { kind: 'tool' | 'skill' | 'agent'; contextId: Ref } {
    const step = entry.step;
    if ('type' in step && step.type === 'toolCall')
      return { kind: 'tool', contextId: toolRef(step.name) };
    if ('role' in step && step.role === 'system') {
      const carrier = renderedContexts(entry.run).find((context) =>
        context.content.includes(fact),
      );
      if (carrier) return { kind: carrier.kind, contextId: carrier.id };
    }
    return { kind: 'agent', contextId: entry.run.agentId };
  }

  /** Runs that relayed the fact downstream, in walk order. */
  private propagators(first: TrajectoryEntry, fact: string): Ref[] {
    const seen = new Set<Ref>([first.run.agentId]);
    const out: Ref[] = [];
    for (const entry of this.entriesAfter(first)) {
      if (seen.has(entry.run.agentId)) continue;
      if (!stepText(entry.step).includes(fact)) continue;
      seen.add(entry.run.agentId);
      out.push(entry.run.agentId);
    }
    return out;
  }

  /** Tools that relayed the fact onward without flagging an error. */
  private missedDetectors(first: TrajectoryEntry, fact: string): Ref[] {
    const seen = new Set<Ref>();
    const out: Ref[] = [];
    for (const entry of this.entriesAfter(first)) {
      const step = entry.step;
      if (!('type' in step && step.type === 'toolCall')) continue;
      const ref = toolRef(step.name);
      if (!step.isError && step.result.includes(fact) && !seen.has(ref)) {
        seen.add(ref);
        out.push(ref);
      }
    }
    return out;
  }

  /** Every entry after the introducing one, in walk order. */
  private entriesAfter(first: TrajectoryEntry): TrajectoryEntry[] {
    const at = this.entries.indexOf(first);
    return at === -1 ? [] : this.entries.slice(at + 1);
  }

  private entryByRef(stepRef: Ref): TrajectoryEntry | undefined {
    return this.entries.find((entry) => entry.ref === stepRef);
  }
}
