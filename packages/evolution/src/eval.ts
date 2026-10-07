import type { Ref } from './types.ts';

/** Where a test instance came from. */
export type EvalSource = 'failure' | 'human' | 'seed';

/** A persisted test instance for one context. */
export interface ContextEval {
  id: string;
  contextId: Ref;
  /** The stimulus the context must handle. */
  input: string;
  /** The correct output — optional (a regression case without a known answer). */
  expected?: string;
  source: EvalSource;
  createdAt: number;
}

/** A candidate test instance, before the store stamps `id` + `createdAt`. */
export type EvalCandidate = Omit<ContextEval, 'id' | 'createdAt'>;

/**
 * The failing input that drives eval derivation — grounded data only, never an
 * invented fact. `correction` (from back-pressure) becomes the eval's `expected`.
 */
export interface FailingTrajectory {
  input: string;
  correction?: string;
}

/**
 * Value assessment: is `candidate` worth persisting for a context given its
 * existing evals? Pluggable — the default dedups by input.
 */
export type EvalValueAssessor = (
  existing: ContextEval[],
  candidate: EvalCandidate,
) => boolean;

/** Default heuristic: dedup by input string. */
export const dedupByInput: EvalValueAssessor = (existing, candidate) =>
  !existing.some((e) => e.input === candidate.input);

/** Per-context eval persistence + value assessment. */
export interface ContextEvalStore {
  evalsFor(contextId: Ref): ContextEval[];
  worthAdding(contextId: Ref, candidate: EvalCandidate): boolean;
  /** Persist only when valuable; null = rejected as a duplicate. */
  persist(candidate: EvalCandidate): ContextEval | null;
}

/**
 * Turns a failing input into candidate test instances, one per relevant context
 * (culprit + dependents, §11). Runs before the evolution loop proposes anything.
 */
export interface TestInstanceDeriver {
  derive(failing: FailingTrajectory, relevantContexts: Ref[]): EvalCandidate[];
}

export class InMemoryContextEvalStore implements ContextEvalStore {
  private byContext = new Map<Ref, ContextEval[]>();
  private seq = 0;

  constructor(private readonly assess: EvalValueAssessor = dedupByInput) {}

  evalsFor(contextId: Ref): ContextEval[] {
    return this.byContext.get(contextId) ?? [];
  }

  worthAdding(contextId: Ref, candidate: EvalCandidate): boolean {
    return this.assess(this.evalsFor(contextId), candidate);
  }

  persist(candidate: EvalCandidate): ContextEval | null {
    if (!this.worthAdding(candidate.contextId, candidate)) return null;
    const stored: ContextEval = {
      ...candidate,
      id: `eval-${++this.seq}`,
      createdAt: Date.now(),
    };
    const list = this.byContext.get(candidate.contextId) ?? [];
    list.push(stored);
    this.byContext.set(candidate.contextId, list);
    return stored;
  }
}

export class DefaultTestInstanceDeriver implements TestInstanceDeriver {
  derive(failing: FailingTrajectory, relevantContexts: Ref[]): EvalCandidate[] {
    // ponytail: same grounded {input, expected} for every relevant context;
    // per-context input shaping (tool args vs. dependent stimulus) is a model
    // seam to add when evals need finer fidelity.
    return relevantContexts.map((contextId) => ({
      contextId,
      input: failing.input,
      expected: failing.correction,
      source: 'failure',
    }));
  }
}
