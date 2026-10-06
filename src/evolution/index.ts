/**
 * Public surface of the evolution framework — interfaces and types only.
 * No implementation classes; the runtime adapter (out of scope) wires them.
 */

export type { BackPressure } from './back-pressure.ts';
export type { Executor } from './executor.ts';
export type { Pinpointer } from './pinpoint.ts';
export type { TaskObserver, TrajectoryQuery, WikiPort } from './ports.ts';
export type { PatchProposer } from './proposer.ts';
export type { ContextRegistry } from './store/context-registry.ts';
export type { RetentionOptions, RetentionPolicy } from './store/retention.ts';
export type { TrajectoryStore } from './store/trajectory.ts';
export type { WikiMaintainer } from './store/wiki.ts';
export type { WikiPersistence } from './store/wiki-persistence.ts';
export type {
  DistilledEntry,
  DistilledLog,
  Judger,
  Run,
  TrajectoryDistiller,
} from './trajectory-distiller.ts';
export type {
  Author,
  Context,
  ContextEdge,
  ContextKind,
  ContextUsage,
  Ref,
  Role,
  Status,
  TaskEvent,
  TaskKind,
  TranscriptRecord,
  TranscriptRole,
} from './types.ts';
export type {
  Blame,
  ContextPatch,
  Culprit,
  CulpritKind,
  FailureLocation,
  Introduction,
  Verdict,
  WikiRow,
  WikiRowKind,
} from './wiki-types.ts';
