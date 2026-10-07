# Evolution Framework — Implementation Plan

**Status:** Planned — restructured 2026-10-06 to match
`docs/architecture/evolution.excalidraw`. No implementation begun beyond the
four done groups.

## Constraints

1. Everything lives under `src/evolution/`.
2. **Interface-first:** every component exposes a TypeScript *interface* (port)
   and depends only on other interfaces. No component imports an implementation,
   pi-durable, or any existing `src/` module.
3. Implementations plug in **behind** the ports (in-memory for tests, SQLite as
   the default wiki, a substrate adapter later) and are swappable.
4. **Do not modify any existing source file.** Executor/substrate wiring is a
   later, separate phase (see "Out of scope").
5. One runnable self-check per non-trivial component (vitest, repo-standard).

Reference: [ADR-0003](./adr/003-pi-durable-task-graph-substrate.md),
[evolution framework HLD/LLD](./evolution-framework.md),
[evolution.excalidraw](./evolution.excalidraw).

## Core model

**Everything that can be improved or added to the AI is a context.** Tools,
skills, and `agent.md` are all context. The evolution framework patches
**context**, never code:

- `ContextKind = 'tool' | 'skill' | 'agent'`
- `ContextPatch = { contextId: string; contextKind: ContextKind; patch: string }`
- A culprit always maps to the context to patch: wrong tool behavior → the
  tool's context; a misleading skill → the skill's context; the agent reasoned
  wrong with correct context → the agent's `agent.md`.

**Lessons are not context.** The wiki feeds only the **evolution loop** (Patch
Proposer, distillers, verifier) — never the executor. The executor's contexts
are tools, skills, and `agent.md` only.

> **Ablation study (planned):** whether wiki lessons should *also* plug into the
executor is deferred to an ablation experiment; today the wiki wires to the
Patch Proposer only.

**Each context carries evals, grown from failures.** Before the evolution loop
proposes anything, it derives candidate **test instances** from the currently
failing input — scoped to the relevant contexts (culprit + dependents) — and
persists a candidate only if it adds value over that context's existing evals
(looked up per context). The Verifier later runs these persisted evals.

**Contexts have dependencies, and evolution runs on that graph.** A context
declares what it depends on; a run records which contexts were actually used and
the *used* edges between them:

- `Context { id, kind: ContextKind, content, dependsOn: Ref[] }` — the artifact.
- per task: `contextsUsed: { contextId, version, recordRef }[]` + the used edges
  `contextEdges: { from, to }[]` ("context `from` used context `to`").

Blame, patching, and validation follow the graph: a wrong context's blast radius
is its transitive dependents; patching a context re-validates it **and** every
context that depends on it; strategies/patterns/failures (wiki rows) are keyed
to the context subgraph that produced them.

This **replaces** the ADR's `agent|skill|tool|context` target split (ADR §6 now
patches contexts only) and `PatchHypothesis { targetKind, targetId, diff }`
(`wiki-types.ts` is amended: `PatchHypothesis`/`PatchTarget` → `ContextPatch`,
`CulpritKind` → `ContextKind`).

## Flow (from evolution.excalidraw + context graph)

```
Executor(takes goal + trajectory) → produces → Trajectory
  → Trajectory Distiller → distilled log → WikiMaintainer → Wiki (patterns, strategies)
      → [Wiki Persistence store]
  → derive test instances from the failing input (relevant contexts)
      → persist only if valuable vs. that context's evals → [context evals]
  → Patch Proposer → Context Patch (a patch to context)
      → targets: tools · skills · agents.md (all context, linked by usage edges)
  → Verifier (new test instance + context evals) → Success / Failure
      → Verifier Distiller → wiki
      → Approved patches retention
  → on Failure: patch proposer loop continues
```

## Target layout

```
src/evolution/
  types.ts                  # done (amend: Context, ContextKind, ContextUsage)
  task.ts                   # done (amend: contextsUsed + contextEdges)
  wiki-types.ts             # done (amend: ContextPatch, CulpritKind = ContextKind)
  ports.ts                  # done
  eval.ts                   # ContextEval + ContextEvalStore + TestInstanceDeriver
  executor.ts               # Executor port (interface only)
  evolution-loop.ts         # propose → validate → bounded-retry orchestration
  store/
    trajectory.ts           # done (in-memory) — extend with context-edge index
    context-registry.ts     # Context graph: dependents(), subgraph()
    wiki.ts                 # WikiMaintainer + Wiki Persistence store
    retention.ts            # eviction + top-k
    approved-patches.ts     # approved patches retention
  distill/
    trajectory-distiller.ts # trajectory → distilled log
    verifier-distiller.ts   # verifier outcomes → wiki rows
  pinpoint.ts
  back-pressure.ts
  propose/
    proposer.ts             # → Context Patch (graph-aware)
  verify/
    verifier.ts             # C + C' → success/failure (validates dependents too)
  gate.ts
  index.ts                  # interfaces only
```

## Todos

### Done

- [x] **1. Core types** — `types.ts`, `task.ts`
- [x] **2. Ports** — `ports.ts` (`TaskObserver`, `TrajectoryQuery`, `WikiPort`)
- [x] **3. Wiki types** — `wiki-types.ts` (`WikiRow`, `Blame`, `Culprit`, `Verdict`)
- [x] **4. Trajectory store** — `store/trajectory.ts` (interface + in-memory) + test

### Remaining

- [x] **5. Context model & usage graph** — amend `types.ts`, `task.ts`
  - [x] `ContextKind = 'tool' | 'skill' | 'agent'`.
  - [x] `Context { id, kind, content, dependsOn: Ref[] }`.
  - [x] `ContextUsage { contextId, version, recordRef }` and `ContextEdge { from, to }`.
  - [x] `TaskEvent`: replace `attachedSkills` with `contextsUsed: ContextUsage[]` + `contextEdges: ContextEdge[]`.
  - [x] Self-check: a skill→tool edge is round-trippable through the store.
- [x] **6. Context registry** — `store/context-registry.ts`
  - [x] `ContextRegistry` interface: `get(id)`, `dependents(id)` (transitive), `subgraph(ids)`, `all()`.
  - [x] In-memory impl; built from `Context.dependsOn` + recorded `contextEdges`.
  - [x] Self-check: A→B→C; `dependents(B)` = {A}; `dependents(C)` = {A, B}.
- [x] **7. Executor port** — `executor.ts`
  - [x] `Executor` interface: `run(goal: string, contexts: Context[]): Promise<Ref[]>` — produces trajectory refs. Interface only, no implementation.
- [x] **8. WikiMaintainer + Wiki Persistence store** — `store/wiki.ts`
  - [x] `WikiMaintainer` interface (extends `WikiPort`), backs onto an injected `WikiPersistence`.
  - [x] `WikiPersistence` interface: `load()`, `save(row)`, `evict(stale)`.
  - [x] In-memory impl (tests), SQLite impl (default).
  - [x] Self-check: record → load round-trips.
- [x] **9. Retention** — `store/retention.ts`
  - [x] Evict rows old **and** unused (`lastUsedAt` + `useCount`); bounded top-k reads by recency × frequency × convergence (for the Patch Proposer, not the executor).
  - [x] Self-check: touch some rows, run eviction, assert only stale-and-cold leave.
- [x] **10. Trajectory Distiller** — `trajectory-distiller.ts`
  - [x] `TrajectoryDistiller` interface: `distill(trajectory): DistilledLog`.
  - [x] Sample positive/negative runs, clean into patterns/strategies/failures **keyed by context subgraph** (model judgment behind an injected `Judger`).
  - [x] `DistilledLog` type (input to `WikiMaintainer`).
  - [x] Self-check: fake Judger row lands in the log.
- [x] **11. Pinpointing (graph-aware)** — `pinpoint.ts`
  - [x] `firstIntroduction` walk over ownership + context edges: blame propagates *up* the task tree and *out* along context usage (a wrong tool context implicates every skill/agent that used it).
  - [x] Tool descent + context descent: first appearance in a tool result vs. a context record → `ContextKind`.
  - [x] `dependents(culpritContext)` = the blast radius for the verdict.
  - [x] Self-check: leaf introduces the fact; relay + its dependents listed in the chain.
- [x] **12. Back-pressure** — `back-pressure.ts`
  - [x] `BackPressure` interface: `push(blamedRef, correction, author)` → a `back_pressure` row (edge-by-edge only).
  - [x] Self-check: one push → one authored row with both refs.
- [x] **13. Patch Proposer (graph-aware)** — `proposer.ts`
  - [x] `PatchProposer` interface: `propose(failures): ContextPatch[]`.
  - [x] Reads `WikiPort.prioritizedFailures()` + culprits; a culprit context yields a `ContextPatch { contextKind, contextId }`; dependents are included as affected (re-validate set).
  - [x] Self-check: a `tool` culprit yields a `ContextPatch { contextKind: 'tool' }` + dependent list.
- [x] **14. Context Patch type** — amend `wiki-types.ts`
  - [x] `ContextPatch { contextId: string; contextKind: ContextKind; patch: string }`.
  - [x] Replace `PatchHypothesis` / `PatchTargetKind`; `CulpritKind = ContextKind`.
- [x] **15. Verifier** — `verifier.ts`
  - [x] `Verifier` interface: `verify(original: Context[], patched: Context[], patch: ContextPatch): Verdict`.
  - [x] Runs **new test instance + the context's persisted evals (§19–21)** on a forked/replay branch via the injected `RunRunner` seam; **re-runs the patched context and its dependents**; never live (runtime wiring out of scope).
  - [x] Success / Failure verdict with `evidenceRefs`; failure → back to proposer (bounded retries, `DEFAULT_MAX_RETRIES = 3`, exposed as `Verifier.maxRetries`).
  - [x] Self-check: fake RunRunner passes once, fails once; assert verdict + retry bound.
- [ ] **16. Verifier Distiller** — `verifier-distiller.ts`
  - [ ] `VerifierDistiller` interface: `distill(verdicts): WikiRow[]` — success/failure → strategy/failure rows keyed by context.
  - [ ] Self-check: a failing verdict → a `failure` row; a passing one → a `strategy` row.
- [ ] **17. Approved patches retention** — `store/approved-patches.ts`
  - [ ] `ApprovedPatchStore` interface: `retain(patch, verdict)`, `list()`.
  - [ ] Self-check: retain → list round-trip.
- [ ] **18. Human gate** — `gate.ts`
  - [ ] `Gate` interface: `review(verdict) → approved|rejected`; only passed verdicts reach it.
  - [ ] Self-check: a failing verdict never reaches `review`.
- [ ] **19. Eval model** — `eval.ts`
  - [ ] `ContextEval { id, contextId, input, expected?, source: 'failure'|'human'|'seed', createdAt }` — a persisted test instance for one context.
  - [ ] `ContextEvalStore` interface: `evalsFor(contextId)`, `worthAdding(contextId, candidate)`, `persist(eval)`.
  - [ ] `TestInstanceDeriver` interface: `derive(failingTrajectory, relevantContexts) → ContextEval[]`.
- [ ] **20. Test Instance Deriver** — impl in `eval.ts`
  - [ ] From the currently failing input (trajectory) + relevant contexts (culprit + dependents, §11), derive candidate test instances per context.
  - [ ] Runs **before** the evolution loop proposes anything.
  - [ ] Self-check: a failing input with a `tool` culprit yields a candidate bound to that tool's context.
- [ ] **21. Eval persistence + value assessment** — impl in `eval.ts`
  - [ ] `worthAdding` compares a candidate against the context's existing evals (dedup by input + coverage/novelty) — pluggable heuristic, default dedup-by-input.
  - [ ] Persist only when valuable; each context ends with its own eval set.
  - [ ] Self-check: identical candidate → `worthAdding` false; novel candidate → true and persisted.
- [ ] **22. Public surface** — `index.ts`
  - [ ] Export interfaces and types only. No implementation classes, no pi-durable, no existing `src/` imports.
- [x] **23. Evolution loop orchestration** — `evolution-loop.ts`
  - [x] `EvolutionLoop` interface: `run(): EvolutionLoopResult` — one pass: wiki failures → propose → verify → bounded retry (failed verdict fed back to the proposer).
  - [x] `PatchApplier` seam (default `appendPatch`) produces the `patched` contexts; `DefaultEvolutionLoop` wires `WikiPort` + `PatchProposer` + `Verifier` + `ContextRegistry`.
  - [x] `PatchProposer` extended with `revise(patch, verdict): ContextPatch | null` — a failed verdict returns to the proposer (Q12); default returns null (no model seam yet).
  - [x] Self-check: pass-once, fail→revise→pass, fail→give-up, and the retry bound via a fake runner/proposer.

## Out of scope (later phase — requires touching existing code)

- [ ] Wire `Executor` / `spawn_agent` / `back_pressure` into the mission runtime.
- [ ] Substrate adapter that publishes `TaskEvent`s (incl. context edges) from a real runtime.
- [ ] Hook the distillers as post-mission passes.
