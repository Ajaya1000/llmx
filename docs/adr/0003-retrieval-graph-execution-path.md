# ADR-0003: Skill retrieval & the top-most executor

**Date:** 2026-09-12
**Status:** Proposed

## Context

The SkillRetriever finds a set of skills with the scoring mechanism ([ADR-0001](./0001-hybrid-retrieval-fusion.md)): `score = w·semantic + (1-w)·lexical`.

## Decision
- At most top k most revant skill is used with `score >= cutoff`
  
## Example
Goal: *"clone the repo, run the tests, fix any failures, and publish a coverage report."*

Retrieval finds `clone-repo`, `run-tests`, `ship-change`, `publish-coverage-report`, `update-readme-badge` — five skills; dev, reporting, and docs are not connected to each other (no author linked them).
- All five skills become part of the top-most executor; the LLM decides which to use — `clone-repo` first (nothing works without a repo), the docs badge last, or not at all.
- If `collect-coverage` (a prerequisite of `publish-coverage-report`) is missing everywhere, the task fails there; the gap is recorded and patched — future retrievals find it.

## Consequences

**Positive**

- Retrieval stays one cheap step — no graph passes at task start
- The LLM decides which skills to use with the full retrieved set in hand
- Sub-skills arrive exactly when they become relevant — via the chosen skill's edges
- The library stays structure-agnostic — no connectivity requirements

**Negative / Risks**
- Execution quality depends on retrieval returning the right skills — mitigated by the hybrid scoring (ADR-0001) and by skill evolution

## References

- [ADR-0001](./0001-hybrid-retrieval-fusion.md) — retrieval scoring · [ADR-0002](./0002-skill-representation-filesystem-frontmatter.md) — skill files · [ADR-0004](./0004-taskmanager-recursive-execution.md) — TaskManager & recursive execution
- HLD §3 · LLD §6
