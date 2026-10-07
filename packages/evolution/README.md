# @llmx/evolution

Interface-first self-improvement framework for LLMx: record a trajectory as a
task graph, distill a curated wiki, pinpoint culprits along the context-usage
graph, and run the two-phase loop — **Eval** (derive distinct, context-specific
test instances) then **Evolve** (propose → validate → retry → gate).

Every component exposes a TypeScript interface (port) and depends only on other
interfaces — no runtime, storage backend, or pi-durable dependency. In-memory
implementations are provided for tests; a `better-sqlite3` wiki persistence is
the default store.

## Layout

- `src/` — types, ports, trajectory/wiki/context stores, distillers, proposer,
  verifier, gate, eval, and the evolution loop.
- `tests/` — one colocated spec per module.

## Scripts

- `npm run build` — `tsc` (emits `dist/`)
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — `vitest run`
- `npm run fix` — `biome check --write src tests`

See `docs/adr/003-pi-durable-task-graph-substrate.md` and
`docs/architecture/evolution-framework.md` for the design, and
[WIRING.md](./WIRING.md) for how to wire the framework to a harness.
