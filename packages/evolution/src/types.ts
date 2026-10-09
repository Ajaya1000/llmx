/**
 * Core evolution types — no runtime dependency, no pi-durable, no existing src.
 * These are the vocabulary every other evolution module shares. The recorded
 * execution itself is the trajectory model (`trajectory.ts`).
 */

/** Opaque reference into the trajectory (a run / step / context id). */
export type Ref = string;

/** Attribution role assigned by pinpointing. */
export type Role = 'introducer' | 'propagator' | 'missed_detector';

/** Everything that can be improved or added to the AI is a context. */
export type ContextKind = 'tool' | 'skill' | 'agent';

/** Who authored a wiki row — a human turn vs. the agent run that lived it. */
export type Author = { kind: 'human' } | { kind: 'agent'; agentId: Ref };

/** A context artifact — its content plus the contexts it depends on. */
export interface Context {
  id: Ref;
  kind: ContextKind;
  content: string;
  /** Static dependencies declared by the artifact (e.g. a skill lists its tools). */
  dependsOn: Ref[];
}
