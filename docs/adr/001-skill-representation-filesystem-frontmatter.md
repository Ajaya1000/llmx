# ADR-0002: Filesystem + YAML front matter as the skill representation

**Date:** 2026-09-12
**Status:** Accepted

## Context

Skills need a storage representation that is simultaneously: readable and writable by both humans and the LLMx pipeline (SkillProposer patches, PatchEvaluator diffs), versionable and reviewable (skill evolution depends on inspecting changes before merge), and usable as the source of truth from which the derived retrieval index is built. Considered options: SQLite or other database, pure JSON files, a single monolithic registry file, and Markdown with YAML front matter.

## Decision

Each skill is a single file on the filesystem: **`skills/<domain>/<slug>/skill.md`** — one skill per directory, `id` = directory slug.

- **YAML front matter** carries all structured properties: `id`, `title`, `description`, `preState`, `postState`, `tools`, `testSuite`, `edges` (`id`, `target`, `forwardDescription`, `backwardDescription`, `condition`), `metadata` (`created`, `stats`)
- **Markdown body** below the front matter carries the procedure the Executor runs
- The files are the **source of truth**; the retrieval index (`.llmx/index.db`) is derived and fully rebuildable
- On load, front matter is parsed into pydantic models and validated (schema, dangling edges, predicate compilation) — YAML is never executed, only compiled to safe predicate lambdas

## Example

`skills/dev/run-tests/skill.md` — all required properties in front matter, procedure in the body:

````markdown
---
id: run-tests
title: Run the test suite
description: Executes the project's test suite and records the outcome in task state.
preState:                      # predicates over TaskState — must hold to enter
  required:
    repo_cloned: true
postState:                     # mutations applied on success (Evaluator checks these)
  sets:
    test_run_complete: true
tools:                         # only these tools are bound while this skill runs
  - shell
testSuite: tests/skills/run-tests   # regression suite run by PatchEvaluator if patched
edges:                         # structure the Executor follows; target = other skill's id
  - id: run-tests--to--fix-failures
    target: fix-failing-tests
    forwardDescription: Tests failed — enter fix-failing-tests with the failing list from state.
    backwardDescription: Fixes did not hold — re-enter run-tests and re-run the full suite.
    condition: test_run_complete == true and tests_passing == false
  - id: run-tests--to--ship
    target: ship-change
    forwardDescription: Suite is green — enter ship-change to commit and open a PR.
    backwardDescription: Ship aborted — re-enter run-tests to confirm the suite is still green.
    condition: tests_passing == true
metadata:
  created: 2026-09-12
  stats:                       # maintained by LLMx (successes update stats)
    runs: 0
    success_rate: 0.0
---

## Procedure

1. Detect the test runner (pytest / npm test / go test …) from the repo.
2. Run the full suite via the `shell` tool.
3. Record `tests_passing = true|false` and store the summary in `last_test_summary`.
4. On failure, also store failing test names in `failing_tests`.
````

## Consequences

**Positive**

- Git-friendly: patches (new skills / edges / edits) review as plain diffs; the approval gate operates on diffs
- Human- and LLM-editable with no tooling; the procedural body stays narrative while structure stays machine-readable
- No database or migration tooling — the filesystem is the interface

**Negative / Risks**

- No transactions or querying — mitigated by the derived index for retrieval and load-time validation for integrity
- YAML is whitespace-sensitive; malformed front matter fails at load with actionable validation errors
- `condition`/state predicates are strings that must pass a safe compiler (no `eval` of arbitrary code)

**Rejected alternatives:** SQLite (queryable, but not diff-reviewable — evolution depends on readable diffs); pure JSON (no natural home for the procedural body); a single registry file (merge conflicts, poor scalability).

## References

- HLD §5 decision #3, §6 Storage Design — `docs/architecture/HLD.md`
- LLD §2.1 skill file schema — `docs/architecture/LLD.md`
