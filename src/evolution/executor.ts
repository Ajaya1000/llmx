import type { Context, Ref } from './types.ts';

/**
 * The execution seam. Runs a goal against a set of contexts (tools, skills,
 * agent.md) and produces the refs of the trajectory records it emitted.
 *
 * Interface only — no implementation lives in the evolution package. A concrete
 * runtime (e.g. a substrate adapter) plugs in behind this port.
 */
export interface Executor {
  run(goal: string, contexts: Context[]): Promise<Ref[]>;
}
