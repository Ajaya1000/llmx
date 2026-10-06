# LLMx — project instructions

Task execution system for LLMs: composes only the skills/tools relevant to one task instance, keeps reasoning (CoT) within a single execution, discards it between tasks. Goal: minimal context, no context poisoning. See README.md and docs/ for the full design.

## Commands

- `npm run typecheck` — tsc --noEmit
- `npm test` — vitest run
- `npm run lint` / `npm run fix` — biome check (fix auto-applies)
- `npm run build` — tsc

## Layout

- `src/agent` — executor core
- `src/mission` — task instances
- `src/skills` — skill structure / graph
- `src/durable`, `src/evolution` — state and skill evolution
- `tests/` mirror `src/` (vitest, one file per module)
- `docs/adr`, `docs/architecture` — read before changing architecture

## Conventions
- Keep the folder structure optimal like a production application. Try to group related files when make sense.
- Limit the number of lines to a pratical readable reasonable number. Do not over bloat each files.
- Strictly follow SOLID principle.
- ESM + strict TypeScript; typebox for schemas; better-sqlite3 for storage.
- Tests colocated per module under `tests/`; run `npm test` after logic changes.
- Run `npm run fix` before finishing any change.
