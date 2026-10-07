# Wiring Evolution to a Harness

`@llmx/evolution` is **ports-only**: every component is an interface with an
in-memory default. It never imports a runtime. The *harness adapter* — the
code you write once, in the app that owns the runtime — is the glue that feeds
harness activity into the framework's ports and runs the loop against them.

This README wires the framework to the **`@llmx/executor` durable harness**
(pi-durable conversations behind `AgentSessionRepository`). Any other runtime
that can (a) run a prompt to a transcript and (b) run it again on a fork with
one context swapped can take its place.

```
harness ──run──▶ adapter ──TaskEvent / TranscriptRecord──▶ trajectory store
                                                                  │
                    ┌─────────────────────────────────────────────┤
                    ▼                                             ▼
        Phase 1 — Eval                                  trajectory distiller
   (test-instance deriver ─▶ eval store)                        │
                    │                                            ▼
                    │                                        wiki (pinpoint,
                    │                                        prioritize failures)
                    │                                            │
                    └────────▶ verifier ◀── Phase 2 — Evolve ──┘
                    forked runs    (proposer ─▶ verifier ─▶ gate)
                        │                        │        │
                        └── patched context ─────┘        ▼
                                              approved-patch store
```

## What you write vs. what ships

| Port | Provided default | Adapter's job |
|---|---|---|
| `Executor` | — (none; intentionally) | run a goal through the harness, record the trajectory, return record refs |
| `TaskObserver` + `TrajectoryQuery` | `InMemoryTrajectoryStore` | translate harness runs into `TaskEvent`s + `TranscriptRecord`s |
| `ContextRegistry` | `InMemoryContextRegistry` | register agents/skills/tools as `Context`s, feed observed usage edges |
| `WikiPort` | `DefaultWikiMaintainer` + `SqliteWikiPersistence` | nothing — construct and pass a pinpointer |
| `Pinpointer` | `DefaultPinpointer` | nothing — construct over trajectory + registry |
| `TrajectoryDistiller` | `DefaultTrajectoryDistiller` | supply a `Judger` (model seam, see *Open seams*) |
| `TestInstanceDeriver` / `ContextEvalStore` | `DefaultTestInstanceDeriver` / `InMemoryContextEvalStore` | nothing for v1 |
| `PatchProposer` | `DefaultPatchProposer` | supply patch text (model seam) |
| `Verifier` | `DefaultVerifier` | supply a `RunRunner` (the forked-run harness call) |
| `Gate` | `DefaultGate` | supply the human decision callback |
| `EvolutionLoop` | `DefaultEvolutionLoop` | nothing — construct the whole graph |
| `ApprovedPatchStore` | `InMemoryApprovedPatchStore` | swap for durable storage if audit matters |

> Packaging note: the package root (`@llmx/evolution`) currently exports the
> **type surface only**. Import the concrete defaults from their module paths
> (e.g. `…/store/trajectory.js`, `…/evolution-loop.js`) until subpath exports
> are added.

## Step 1 — Map harness artifacts to `Context`s

A `Context` is anything improvable: `kind: 'agent' | 'skill' | 'tool'`. Map the
executor's own definitions onto it — an agent's YAML body, a skill's markdown,
a tool's description — and carry static dependencies in `dependsOn` (a skill
lists the tools it uses, an agent lists the skills it renders):

```ts
import type { Context } from '@llmx/evolution';
import type { AgentDefinition } from '@llmx/executor';

function agentToContext(def: AgentDefinition): Context {
  return {
    id: `agent:${def.id}`,
    kind: 'agent',
    content: def.body,                 // the part an LLM can rewrite
    dependsOn: def.tools.map((t) => `tool:${t}`),
  };
}
// Same shape for skills (`kind: 'skill'`, content = SKILL.md) and
// tools (`kind: 'tool'`, content = the tool's description/parameters doc).
```

Register everything up front; the registry is the blast-radius graph:

```ts
import { InMemoryContextRegistry } from '…/store/context-registry.js';

const registry = new InMemoryContextRegistry();
for (const ctx of await loadContexts()) registry.register(ctx);
// Later, per task event:
registry.observe(taskEvent.contextEdges); // runtime usage edges
```

## Step 2 — Record runs into the trajectory

Two writes: one `TaskEvent` per task (via `onTask`), one `TranscriptRecord`
per transcript message (via `record`). This is the `Executor` implementation —
the only class the framework forces you to write:

```ts
import { randomUUID } from 'node:crypto';
import { AgentSessionRepository } from '@llmx/executor';
import type { Executor, Ref, TaskEvent, TranscriptRecord } from '@llmx/evolution';
import type { TrajectoryStore } from '…/store/trajectory.js';
import type { ContextRegistry } from '…/store/context-registry.js';

export class HarnessExecutor implements Executor {
  constructor(
    private readonly repository: AgentSessionRepository,
    private readonly trajectory: TrajectoryStore,
    private readonly registry: ContextRegistry,
  ) {}

  async run(goal: string, contexts: Context[]): Promise<Ref[]> {
    const taskId = `task:${randomUUID()}`;
    this.trajectory.onTask({
      id: taskId,
      kind: 'agent_run',
      producer: 'root',
      // Record which contexts were rendered into this run; recordRef points
      // at the transcript record holding the rendered content.
      contextsUsed: contexts.map((c) => ({
        contextId: c.id, version: '0', recordRef: `${taskId}:ctx:${c.id}`,
      })),
      contextEdges: contexts.flatMap((c) =>
        c.dependsOn.map((to) => ({ from: c.id, to })),
      ),
      inputRefs: [],
      outputRefs: [],
      status: 'running',
    });
    this.registry.observe(contexts.flatMap((c) =>
      c.dependsOn.map((to) => ({ from: c.id, to })),
    ));

    const session = await this.repository.createSession({ cwd: process.cwd() });
    try {
      await session.prompt(goal);
    } finally {
      // Transcribe the transcript: one record per message, in order.
      const outputRefs = session.messages.map((m, i) => {
        const record: TranscriptRecord = {
          id: `${taskId}:r${i}`,
          taskId,
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: textOf(m), // text blocks of the message, joined
        };
        this.trajectory.record(record);
        return record.id;
      });
      return outputRefs; // ← what `Executor.run` resolves to
    }
  }
}
```

Rules that make blame work later:

- **`content` is fact-matching input** — `firstIntroduction(fact)` searches it.
  Put the real rendered text in, not summaries.
- **`parentId` is ownership** (spawned agent → spawner), **`inputRefs`/
  `outputRefs` is provenance** (which records fed which task). Both are all
  the pinpointer needs; wire them from your spawn tool.
- Record **every** task — `agent_run`, `tool_call`, `evaluation`, `proposal`,
  `validation` — through the same `onTask` path. The distiller samples
  top-level runs; children come along via `parentId`.

## Step 3 — Build the wiki

Pinpointing is deterministic and needs no model; the wiki needs a persistence
backend (SQLite is the default) and a retention policy:

```ts
import { DefaultPinpointer } from '…/pinpoint.js';
import { SqliteWikiPersistence } from '…/store/wiki-persistence.js';
import { DefaultWikiMaintainer } from '…/store/wiki.js';

const wiki = new DefaultWikiMaintainer(
  new DefaultPinpointer(trajectory, registry),
  new SqliteWikiPersistence('data/evolution-wiki.sqlite'),
);
```

## Step 4 — Distill runs into wiki rows

The distiller samples each top-level run and asks the `Judger` seam for
judgments; its rows become wiki `failure`/`strategy` entries with culprits
(from `toCulprit(pinpoint(fact))`) that the proposer later targets:

```ts
import { DefaultTrajectoryDistiller } from '…/trajectory-distiller.js';

const distiller = new DefaultTrajectoryDistiller(myJudger); // model seam
for (const row of distiller.distill(trajectory).rows) wiki.record(row);
```

## Step 5 — Phase 1: Eval (before any patch)

For each wiki failure: pinpoint the culprit, derive test instances for the
culprit + its dependents, and persist the non-duplicates:

```ts
import { DefaultTestInstanceDeriver } from '…/eval.js';
import { InMemoryContextEvalStore } from '…/eval.js';

const evals = new InMemoryContextEvalStore();
const deriver = new DefaultTestInstanceDeriver();

for (const failure of wiki.prioritizedFailures()) {
  const culprit = failure.culprit?.ref;
  if (!culprit) continue;
  const relevant = [culprit, ...registry.dependents(culprit)];
  for (const candidate of deriver.derive(
    { input: failure.content },   // grounded failing input — never invented
    relevant,
  )) {
    evals.persist(candidate);
  }
}
```

## Step 6 — Phase 2: Evolve (propose → validate → gate)

The `RunRunner` seam is where the harness comes back in: a **forked** run —
never live — with the patched context rendered instead of the original, plus
the context's evals as stimulus:

```ts
import type { RunRunner } from '…/verifier.js';

const runner: RunRunner = {
  run: (original, patched, patch) => {
    // Forked harness run: fresh session, patched context injected,
    // evals for patch.contextId replayed as stimulus.
    const outcomes = evals
      .evalsFor(patch.contextId)
      .map((e) => runForked(executor, patched, e)); // your harness call
    const failed = outcomes.filter((o) => !o.pass);
    return failed.length === 0
      ? { pass: true, evidenceRefs: outcomes.flatMap((o) => o.evidenceRefs) }
      : { pass: false, evidenceRefs: [], reason: failed[0].reason };
  },
};
```

Then assemble the loop:

```ts
import { DefaultEvolutionLoop } from '…/evolution-loop.js';
import { DefaultPatchProposer } from '…/proposer.js';
import { DefaultVerifier } from '…/verifier.js';
import { DefaultGate } from '…/gate.js';
import { DefaultVerifierDistiller } from '…/verifier-distiller.js';

const loop = new DefaultEvolutionLoop(
  wiki,
  new DefaultPatchProposer(registry), // patch text = model seam
  new DefaultVerifier(runner),        // bounded retries inside
  registry,
  applier,                           // (context, patch) => patched context
);
const { verdicts } = loop.run();

// Feed verdicts back: pass → strategy row, fail → failure row.
for (const row of new DefaultVerifierDistiller().distill(verdicts))
  wiki.record(row);

// Human gate — only passed verdicts ever reach a human.
const gate = new DefaultGate((v) => askHuman(v));
for (const v of verdicts.filter((v) => v.pass))
  if (gate.review(v) === 'approved') approvedPatches.retain(v.patch, v);
```

## Step 7 — The full loop, in order

```ts
// 1. Run (harness → trajectory)          — Executor / TaskObserver
// 2. Distill (trajectory → wiki)        — TrajectoryDistiller + Judger
// 3. Eval (wiki failures → eval store)  — TestInstanceDeriver
// 4. Evolve (wiki → verdicts)           — EvolutionLoop: proposer →
//                                          verifier (forked harness runs) →
//                                          bounded retries
// 5. Gate (verdicts → human)             — Gate + ApprovedPatchStore
// 6. Apply approved patches to the real artifacts (agents/skills/tools)
//    — the only write back into your runtime's source of truth.
```

## Open seams (by design)

Three seams are deliberately unimplemented — they are model-facing and
marked `ponytail:` in the source:

- **`Judger.distill(run)`** — model judgment turning a run into wiki rows.
- **`RunRunner.run`** — your forked-run harness invocation (the only harness
  call inside the loop).
- **`PatchProposer` patch text** — the actual patch content; the default
  emits an empty patch.

Everything else — trajectory, pinpointing, wiki retention, eval derivation,
verdict distillation, retry bounding, gating — works on the provided
defaults.

See `docs/architecture/evolution-framework.md` for the design and
`docs/adr/` for the substrate decision.
