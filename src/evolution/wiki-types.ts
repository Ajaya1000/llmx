import type {
  Author,
  ContextKind,
  Ref,
  Role,
  TaskEvent,
  TranscriptRole,
} from './types.ts';

/** What a wiki row records. */
export type WikiRowKind =
  | 'strategy'
  | 'pattern'
  | 'failure'
  | 'lesson'
  | 'human_response'
  | 'back_pressure'
  | 'patch_hypothesis';

/** What produced the wrong information — the context kind to patch. */
export type CulpritKind = ContextKind;

/** Compact culprit pointer stored on a wiki row. */
export interface Culprit {
  role: Role;
  kind: CulpritKind;
  /** Culprit context ref (tool / skill / agent id). */
  ref?: Ref;
}

/** A proposed patch to one context — never an applied change. */
export interface ContextPatch {
  /** Tool / skill / agent context id. */
  contextId: string;
  contextKind: ContextKind;
  /** Proposed diff / change text, human-reviewed before application. */
  patch: string;
  /** Transitive dependents to re-validate after this patch. */
  affected?: Ref[];
}

/**
 * One distilled judgment. A curated sample — references the trajectory, never
 * stores it. `window`/`useCount`/`lastUsedAt` drive retention.
 */
export interface WikiRow {
  id: string;
  missionId: string;
  kind: WikiRowKind;
  /** What the sample showed — on strategy/failure rows. */
  polarity?: 'positive' | 'negative';
  /** Human vs. ancestor agent (blame must distinguish the two). */
  author: Author;
  refs: {
    blamedRef?: Ref;
    correctionRef?: Ref;
    taskId?: Ref;
  };
  /** Ownership walk, materialized by pinpointing. */
  blameChain?: Ref[];
  culprit?: Culprit;
  content: string;
  patch?: ContextPatch;
  /** Trajectory span this row was sampled from. */
  window?: { from: number; to: number };
  useCount: number;
  lastUsedAt: number;
  createdAt: number;
}

/** Provenance-only first-introduction result — no context graph involved. */
export interface Introduction {
  culprit: TaskEvent;
  role: Role;
  /** The record that first carried the fact — drives tool/context descent. */
  introducedBy?: { recordId: Ref; role: TranscriptRole; contextId?: Ref };
  /** Tasks that reused the fact downstream (after the introducer). */
  propagators: Ref[];
}

/** Graph-aware blame: provenance + context-kind descent + blast radius. */
export interface Blame extends Introduction {
  /** Context kind at fault, when the fact traces to a context. */
  culpritKind?: ContextKind;
  /** The context id at fault (tool / skill / agent). */
  culpritContextId?: Ref;
  /** Ownership chain upward from the culprit task. */
  ancestors: Ref[];
  /** Validation/evaluation tasks that saw the fact and passed. */
  missedDetectors: Ref[];
  /** Transitive context dependents — the re-validate blast radius. */
  dependents: Ref[];
}

/** Wiki-safe structured failure location — what the proposer consumes. */
export interface FailureLocation {
  /** The wrong output / fact being blamed. */
  fact: string;
  /** Compact culprit: what to patch. */
  culprit: Culprit;
  /** The record that first carried the fact. */
  introducedBy?: { recordId: Ref; role: TranscriptRole; contextId?: Ref };
  propagators: Ref[];
  ancestors: Ref[];
  missedDetectors: Ref[];
  dependents: Ref[];
}

/** Validation outcome for one hypothesis. */
export interface Verdict {
  hypothesisId: string;
  pass: boolean;
  evidenceRefs: Ref[];
}
