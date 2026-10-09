/**
 * Public surface of the evolution framework. Ports as types, plus the
 * composition root (`Evolution`) — the client provides a trajectory and the
 * two model/harness seams (`Judger`, `RunRunner`); everything else derives
 * and drives itself. Concrete per-module classes stay on their module paths.
 */

export type { BackPressure } from './back-pressure.ts';
export type {
  ContextEval,
  ContextEvalStore,
  EvalCandidate,
  EvalSource,
  EvalValueAssessor,
  FailingTrajectory,
  TestInstanceDeriver,
} from './eval.ts';
export type {
  EvolutionLoop,
  EvolutionLoopResult,
  PatchApplier,
} from './evolution-loop.ts';
export type { Executor } from './executor.ts';
export type { Gate, GateDecision } from './gate.ts';
export type { Pinpointer } from './pinpoint.ts';
export type { ContextStore, ModelCall, WikiPort } from './ports.ts';
export type { PatchProposer } from './proposer.ts';
export {
  Evolution,
  type EvolutionOptions,
  type EvolutionResult,
} from './runtime.ts';
export type {
  ApprovedPatch,
  ApprovedPatchStore,
} from './store/approved-patches.ts';
export type { ContextRegistry } from './store/context-registry.ts';
export { InMemoryContextStore } from './store/context-store.ts';
export type { RetentionOptions, RetentionPolicy } from './store/retention.ts';
export type { WikiMaintainer } from './store/wiki.ts';
export type { WikiPersistence } from './store/wiki-persistence.ts';
export { SqliteWikiPersistence } from './store/wiki-persistence.ts';
export type {
  ContentBlock,
  JsonObject,
  RenderedContext,
  RunContext,
  StepKind,
  ToolDescription,
  Trajectory,
  TrajectoryEntry,
  TrajectoryStep,
} from './trajectory.ts';
export {
  allRuns,
  renderedContexts,
  stepKind,
  stepRef,
  stepText,
  toolRef,
  toolsOffered,
  walkTrajectory,
} from './trajectory.ts';
export type {
  DistilledEntry,
  DistilledKind,
  DistilledRun,
  Judger,
  RunView,
  TrajectoryDistiller,
  ViewEdge,
  ViewEdgeKind,
  ViewStep,
} from './trajectory-distiller.ts';
export {
  buildRunView,
  DefaultTrajectoryDistiller,
  PromptedJudger,
} from './trajectory-distiller.ts';
export type {
  Author,
  Context,
  ContextKind,
  Ref,
  Role,
} from './types.ts';
export type { RunOutcome, RunRunner, Verifier } from './verifier.ts';
export type { VerifierDistiller } from './verifier-distiller.ts';
export type { WikiAgent } from './wiki-distiller.ts';
export { PromptedWikiAgent } from './wiki-distiller.ts';
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
