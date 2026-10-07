# @llmx/executor

LLMx task executor core: the agent (`TaskExecutor`), pi-durable sessions and
spawn tooling, the mission manager + TUI, skill parsing/schema, and the
in-memory wiki maintainer.

Consumes the pi runtime (`pi-agent-core`, `pi-ai`, `pi-durable`, `pi-tui`) and
defines the executor's public surface in `src/index.ts`.

## Layout

- `src/agent` — executor core + agent definitions
- `src/durable` — pi-durable sessions, harness, model resolution, spawn tool
- `src/mission` — mission manager, TUI, logger, wiki maintainer
- `src/skills` — skill YAML parsing, schema (typebox), predicates, store
- `src/types.ts` — shared mission/agent types

## Scripts

- `npm run build` — `tsc` (emits `dist/`)
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — `vitest run`
- `npm run fix` — `biome check --write src tests`
