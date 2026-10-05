# Plan: Remove the `SpawnRunner` singleton and replace it with a per-conversation injected tool

## Status

Planned — awaiting go-ahead. No code changes have been made.

## Problem

The `spawn_agent` capability is wired through a **module-level mutable singleton**:

- `src/durable/spawn-delegate.ts` declares `let runner: SpawnRunner | undefined`, plus `setSpawnRunner()` / `runSpawn()`.
- `src/mission/manager.ts` calls `setSpawnRunner(createSpawnRunner({ factory, agentDefs }))` inside `run()`.
- `src/durable/spawn-tool.ts` (the `spawn_agent` tool) calls `runSpawn(...)` at execution time, reading that global.

Consequences of the current design:

1. **Hidden global state** — the dependency between the mission runtime and the durable tool is invisible; a second `MissionManager` (tests, future multi-mission processes) silently clobbers the first runner. No isolation.
2. **No lifecycle / teardown** — the runner stays installed after `run()` finishes, pointing at a factory whose harness is already closed by `closeDurableHarness()`.
3. **Direction inversion done via global, not injection** — the durable layer reaches up to the mission layer through a process-wide variable rather than a declared seam.
4. **Split responsibilities** — the spawn policy is scattered: depth-limiting + unknown-agent guards live in `DefaultTaskExecutorFactory`, while the edge allowlist lives in the `createSpawnRunner` closure (`mission/spawn.ts`). The durable layer only shuttles values.

## Goal

Delete the module-level `runner` / `setSpawnRunner` / `runSpawn`. Make spawn a first-class capability on the mission-owned **factory**, and inject the `spawn_agent` tool **per conversation** (not per harness), so the object graph is acyclic and nothing is global.

## The core design decision: break the cycle, not hide it

An earlier iteration threaded the handler through the harness config, producing this reference cycle:

```
harness ─install──► spawn tool ─call──► handler ─► factory ─► repository ─open──► harness
```

Even a lazy supplier left the loop intact, because the repository carried the handler back into the harness config. The root cause: the **harness owns the tool globally**, but the tool's behavior is **per-mission** — two lifetimes fused into one object.

The fix: **stop installing `spawn_agent` on the harness at all.** `ConversationCreateOptions.agent.tools` accepts concrete `ToolRegistration[]` (full tools with `execute` closures, per `pi-durable` types), so each conversation carries its own tool, closed over its own mission's handler. This is what the stale comment in `durable/index.ts:46` was already gesturing at ("an array offers exactly these tools").

Resulting flow — every edge points downward, no global, no cycle:

```
MissionManager
  └─ DefaultTaskExecutorFactory          (owns agentDefs, repository, ui, cwd, maxSpawnDepth)
       ├─ spawn(input)                   ← the capability: edge check → create() → child.run()
       └─ create(ctx) → TaskExecutor { spawn }
            └─ run() → repository.createSession({ spawn })
                 └─ harness.createConversation({ agent: { tools: [createSpawnAgentTool(spawn)] } })
```

Reference graph, end to end:

- `harness` → storage / models / registry — **no spawn tool anymore**
- `repository` → `harness` (unchanged, one-way)
- `tool` → `handler` → `factory` → `repository` — all downward
- `TaskExecutor` → `factory` (benign parent→child reference only)

## Target architecture

Dependency directions (unchanged from today):

```
mission  ──►  agent  ──►  durable        (imports downward)
mission  ──────────────►  durable
```

The seam between the durable-hosted tool and the mission-owned behavior is a **function port** (`SpawnHandler`) captured by the tool at build time via a closure — no module state, no harness config.

### Module layout after the change

| File | Change |
| --- | --- |
| `src/durable/spawn-delegate.ts` | **Deleted.** |
| `src/durable/spawn-tool.ts` | Keep `SpawnParams`; add `SpawnInput`, the `SpawnHandler` port type, and `createSpawnAgentTool(handler)` returning a `ToolRegistration`. Drop the module-level `SpawnAgentTool` const and `spawnExtension()`. |
| `src/durable/durable-harness.ts` | Remove `registry.install(spawnExtension())`. Keep `installExtensions` for tests. |
| `src/durable/index.ts` | `CreateSessionParams` gains `spawn?: SpawnHandler`; `createSession` builds `agent.tools` from it (absent → no tool). |
| `src/agent/taskExecutorFactory.ts` | Add `spawn(input: SpawnInput): Promise<string | undefined>` to `DefaultTaskExecutorFactory` (edge allowlist + `create()` + `child.run()`). |
| `src/agent/agent.ts` | `TaskExecutor` carries an optional `spawn` handler and passes it through to `repository.createSession`. |
| `src/mission/manager.ts` | Drop `setSpawnRunner` call. (Factory already wired to repository; no extra wiring.) |
| `src/mission/spawn.ts` | **Deleted** — its edge-allowlist logic moves into `DefaultTaskExecutorFactory.spawn()`. |
| `tests/spawn.test.ts` | New unit tests for the spawn capability (edge refusal, depth limit, unknown agent, child-failure wrapping) via a fake `TaskExecutorFactory` / fake repository. |
| `tests/durable.test.ts` | Add a case asserting the tool is absent/present based on the `spawn` param (optional). |
| `docs/adr/003-*.md` | Short ADR recording the decision (optional; see Open questions). |

### Type seam (port)

In `src/durable/spawn-tool.ts`:

```ts
export const SpawnParams = Type.Object({ agent: ..., task: ... }); // unchanged

export type SpawnInput = Static<typeof SpawnParams> & {
  parentAgentId: string;
  parentDepth: number;
};

/** The port the durable tool calls; implemented by the mission layer's factory. */
export type SpawnHandler = (input: SpawnInput) => Promise<string | undefined>;

/** Builds the spawn_agent tool bound to `handler`; injected per conversation via `agent.tools`. */
export function createSpawnAgentTool(handler: SpawnHandler): ToolRegistration {
  return defineTool({
    name: 'spawn_agent',
    description: /* unchanged */,
    parameters: SpawnParams,
    execute: async (args, api, context) => {
      const parent = await api.snapshot(AgentContextDoc, api.conversationId, context);
      try {
        const text = await handler({
          parentAgentId: parent?.agentId ?? 'unknown',
          parentDepth: parent?.depth ?? 0,
          agent: args.agent,
          task: args.task,
        });
        if (text === undefined) return { content: [{ type: 'text', text: 'Agent produced no output.' }] };
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        const e = err as Error;
        return { content: [{ type: 'text', text: `Spawn failed: ${e.message}` }], isError: true };
      }
    },
  });
}
```

`runSpawn` / `setSpawnRunner` / module `runner` / `spawnExtension()` are gone.

### Capability on the factory

`DefaultTaskExecutorFactory` already owns `agentDefs`, `create()`, `repository`, `ui`, `cwd`, `maxSpawnDepth` — everything spawn needs. Add one method:

```ts
// src/agent/taskExecutorFactory.ts
async spawn(input: SpawnInput): Promise<string | undefined> {
  const parent = this.agentDefs.find((d) => d.id === input.parentAgentId);
  const allowed = parent?.edges.map((e) => e.target) ?? [];
  if (allowed.length > 0 && !allowed.includes(input.agent)) {
    throw new Error(
      `spawn_agent refused: "${input.parentAgentId}" may only spawn [${allowed.join(', ')}] (its declared edges), not "${input.agent}".`,
    );
  }

  const child = this.create({
    task: input.task,
    agentId: input.agent,
    depth: input.parentDepth + 1,
  });

  try {
    const result = await child.run();
    return result.text || '(no output)';
  } catch (err) {
    const e = err as Error;
    throw new Error(`Agent ${child.agentId} failed: ${e.name}: ${e.message}`);
  }
}
```

Depth-limit and unknown-agent guards stay in `create()` (unchanged). The refusal message also fixes an existing bug that interpolated `input.agent` twice.

### Wiring / construction order

No cycle to break: the handler is a bound method on the factory, and it flows forward through the executors the factory itself creates.

```ts
// src/agent/taskExecutorFactory.ts — create()
const child = new TaskExecutor({
  ...,
  spawn: this.spawn.bind(this),   // or (input) => this.spawn(input)
});
```

```ts
// src/agent/agent.ts — run()
this.session = await this.repository.createSession({
  ...(this.cwd ? { cwd: this.cwd } : {}),
  agentContext: { agentId: this.agentId, depth: this.depth },
  ...(this.spawn ? { spawn: this.spawn } : {}),
});
```

```ts
// src/durable/index.ts — createSession()
const conversationOption: ConversationCreateOptions = {
  ownership: { kind: 'ownerless' },
  agent: {
    model: { provider: model.provider, modelId: model.id },
    ...(params.cwd ? { cwd: params.cwd } : {}),
    ...(params.spawn ? { tools: [createSpawnAgentTool(params.spawn)] } : {}),
  },
  init: ...,
};
```

`MissionManager.run()` drops the `setSpawnRunner` call entirely; the factory is constructed exactly as today with the repository, and `factory.create(...)` threads `spawn` into the entry executor and every child.

## Behavior changes to flag

1. **Tool availability.** Today `spawn_agent` is always installed and throws `No spawn handler installed...` if called without a runner. After the change it is injected **per conversation, only when a handler is provided**; a repository used standalone (no mission runtime) simply has no `spawn_agent` tool. An uncallable tool is never advertised to the model. (This also removes the runtime-throw path.)
2. **Refusal message wording.** Fixes an existing bug where the edge-refusal message interpolated `input.agent` in both the subject and the object. New wording identifies the **parent** as the constrained party: `spawn_agent refused: "<parentId>" may only spawn [a, b], not "<agent>"`.
3. **Leaf depth-hiding — now free.** The factory omits `spawn` for executors at/near `maxSpawnDepth`, so a leaf conversation never receives the tool. This fixes the currently-unimplemented `durable/index.ts:46` comment. Note the existing off-by-one in `create()` (`depth >= maxSpawnDepth` throws, so a `maxSpawnDepth`-depth executor is never actually created) — decide whether to reconcile while here (see Open questions).

## Incidental defects discovered during research (call out, decide scope)

These are adjacent, not caused by this refactor. Typecheck and tests currently do not pass:

- `src/agent/agent.ts:2` imports `../durable/agent-session.ts` — **file does not exist** (`tsc` error TS2307). The class actually lives in `src/durable/index.ts` (imported as `DurableAgentSession`).
- `src/index.ts:3` barrel re-exports the same missing `./durable/agent-session.ts` (TS2307).
- `src/agent/agent.ts:3` — `DurableAgentSession` is not exported from `../durable/index.ts` (TS2459); `durable-session.ts` exports it.
- `src/agent/agent.ts:71` — implicit-any `event` param (TS7006).
- `tests/agent.test.ts` / `tests/definitions.test.ts` import removed symbols (`MissionAgent`, `EnvironmentImpl`, `CommitLog`, `spawnAgentTool`) — they are stale.
- `tests/durable.test.ts` imports removed `createDurableSession`.

Recommended handling (see Open questions): fix the import-path/export/typecheck defects as part of this work (they touch the spawn-adjacent agent layer), and replace the two stale spawn-semantics tests with `tests/spawn.test.ts` against the new factory `spawn()` method using a fake `TaskExecutorFactory` / fake repository (no DB needed). `tests/durable.test.ts` refresh can be a follow-up if it is not trivial.

## Verification

- `npm run typecheck` — clean.
- `npm run test` — the new `tests/spawn.test.ts` passes; no regressions.
- `npm run lint` (biome) if applicable.

## Open questions

1. **Capability home** — method on `DefaultTaskExecutorFactory.spawn()` (recommended), or a dedicated `SpawnRunner` class wrapping `{ factory, agentDefs }`?
2. **Leaf depth-hiding** — implement it now (omit `spawn` at the leaf; recommended) and reconcile the `create()` off-by-one, or keep it out of scope?
3. **Scope** — include the typecheck/import fixes + stale-test replacement in this change (recommended), or keep this PR strictly to the spawn refactor and track defects separately?
4. **Docs** — add a short ADR-0003 recording the "per-conversation tool injection" decision, or just update ADR-0002's revision line?
