/**
 * Core evolution types — no runtime dependency, no pi-durable, no existing src.
 * These are the vocabulary every other evolution module shares.
 */

/** Opaque reference into the trajectory (a record / task / artifact id). */
export type Ref = string;

/** Every unit of work in the evolution framework is one of these. */
export type TaskKind =
  | 'agent_run'
  | 'tool_call'
  | 'evaluation'
  | 'proposal'
  | 'validation';

/** Lifecycle of a task. */
export type Status = 'running' | 'done' | 'failed' | 'aborted';

/** Attribution role assigned by pinpointing. */
export type Role = 'introducer' | 'propagator' | 'missed_detector';

/** Who authored a record — a human turn vs. an ancestor agent's correction. */
export type Author = { kind: 'human' } | { kind: 'task'; taskId: Ref };

/** Everything that can be improved or added to the AI is a context. */
export type ContextKind = 'tool' | 'skill' | 'agent';

/** A context artifact — its content plus the contexts it depends on. */
export interface Context {
  id: Ref;
  kind: ContextKind;
  content: string;
  /** Static dependencies declared by the artifact (e.g. a skill lists its tools). */
  dependsOn: Ref[];
}

/** A context as actually used in one task — what got rendered. */
export interface ContextUsage {
  contextId: Ref;
  /** Version of the context definition at the time of use. */
  version: string;
  /** Ref of the record holding the rendered context (what was shown). */
  recordRef: Ref;
}

/** Runtime usage edge: context `from` used context `to`. */
export interface ContextEdge {
  from: Ref;
  to: Ref;
}

/** Role of an immutable transcript record. */
export type TranscriptRole =
  | 'user'
  | 'assistant'
  | 'tool_call'
  | 'tool_result'
  | 'context_injection'
  | 'verdict';

/**
 * One immutable transcript record — what a model, tool, or human produced or
 * consumed. `content` is what fact-matching (`firstIntroduction`) searches.
 */
export interface TranscriptRecord {
  id: Ref;
  taskId: Ref;
  role: TranscriptRole;
  content: string;
  /** Tool / context that produced this record (tool_result / context_injection). */
  contextId?: Ref;
}

/**
 * The produces-record — what one task made, from what. Emitted for EVERY task
 * via the TaskObserver port. Its two edges (parentId = ownership,
 * inputRefs/outputRefs = provenance) are all blame needs; `contextEdges` is the
 * context dependency graph observed during this task.
 */
export interface TaskEvent {
  id: Ref;
  kind: TaskKind;
  /** Owner task — the ownership edge. Absent for a top-level task. */
  parentId?: Ref;
  /** Which agent produced this task. */
  producer: Ref;
  /** Contexts used in this task (tool / skill / agent). */
  contextsUsed: ContextUsage[];
  /** Which context used which — runtime dependency edges. */
  contextEdges: ContextEdge[];
  /** What the task consumed. */
  inputRefs: Ref[];
  /** What the task produced. */
  outputRefs: Ref[];
  status: Status;
}
