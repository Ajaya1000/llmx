# LLMx — project instructions

Task execution system for LLMs: composes only the skills/tools relevant to one task instance, keeps reasoning (CoT) within a single execution, discards it between tasks. Goal: minimal context, no context poisoning. See README.md and docs/ for the full design.

## Commands

- `npm run typecheck` — tsc --noEmit (all workspaces)
- `npm test` — vitest run (all workspaces)
- `npm run lint` / `npm run fix` — biome check (fix auto-applies)
- `npm run build` — tsc (all workspaces)

## Layout

- `packages/executor/src/agent` — executor core
- `packages/executor/src/mission` — task instances
- `packages/executor/src/skills` — skill structure / graph
- `packages/executor/src/durable` — pi-durable state
- `packages/evolution` — the self-improvement framework (separate npm workspace; `WIRING.md` — wiring it to a harness)
- `packages/*/tests/` mirror each package's `src/` (vitest, one file per module)
- `docs/adr`, `docs/architecture` — read before changing architecture

## Conventions
- Keep the folder structure optimal like a production application. Try to group related files when make sense.
- Limit the number of lines to a pratical readable reasonable number. Do not over bloat each files.
- Strictly follow SOLID principle.
- ESM + strict TypeScript; typebox for schemas; better-sqlite3 for storage.
- Tests colocated per module under `tests/`; run `npm test` after logic changes.
- Use mermaid for all diagrams in docs and READMEs — no ASCII-art diagrams.
- Run `npm run fix` before finishing any change.
