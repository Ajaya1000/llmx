import type { Context, Ref } from './types.ts';
import type { ContextPatch, Verdict } from './wiki-types.ts';

/** One forked validation run — "new test instance + evals", never live. */
export interface RunOutcome {
  pass: boolean;
  /** Refs into the validation task's records (evidence for the verdict). */
  evidenceRefs: Ref[];
  /** Optional short reason (e.g. which eval failed). */
  reason?: string;
}

/**
 * The seam that runs a patch on a forked/replay branch. Injected so the
 * verifier never touches the runtime; the adapter wires it to a real fork.
 */
export interface RunRunner {
  run(original: Context[], patched: Context[], patch: ContextPatch): RunOutcome;
}

/** Bound of the propose → validate → retry loop (Q12). */
export const DEFAULT_MAX_RETRIES = 3;

/**
 * Validates a proposed patch before the human gate: runs it on a forked branch
 * against the new test instance plus the context's persisted evals, and
 * re-checks the patched context's dependents. A failed verdict is fed back to
 * the proposer; the orchestration loop retries up to `maxRetries` times.
 */
export interface Verifier {
  readonly maxRetries: number;
  verify(original: Context[], patched: Context[], patch: ContextPatch): Verdict;
}

export class DefaultVerifier implements Verifier {
  readonly maxRetries: number;

  constructor(
    private readonly runner: RunRunner,
    maxRetries = DEFAULT_MAX_RETRIES,
  ) {
    this.maxRetries = maxRetries;
  }

  verify(
    original: Context[],
    patched: Context[],
    patch: ContextPatch,
  ): Verdict {
    const outcome = this.runner.run(original, patched, patch);
    return {
      patch,
      pass: outcome.pass,
      evidenceRefs: outcome.evidenceRefs,
      reason: outcome.reason,
    };
  }
}
