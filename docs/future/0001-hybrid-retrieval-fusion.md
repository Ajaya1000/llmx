# ADR-0001: Skill retrieval — hybrid scoring & the top-most executor

**Date:** 2026-09-12
**Status:** Accepted (absorbs former ADR-0003, Proposed at merge)

## Context

The `SkillRetriever` must find the skills relevant to a goal and rank them. Pure vector search misses exact keyword matches (identifiers, error codes, CLI flags); pure lexical search misses paraphrases and intent. Separately, once retrieval returns a set of skills, something must decide how that set is consumed by execution — who picks which skill runs, and when sub-skills enter.

## Decision

### 1. Scoring: weighted-average hybrid retrieval (semantic + BM25)

Fuse semantic and lexical signals with a weighted average:

```
score = w·semantic + (1-w)·lexical,  0 ≤ w ≤ 1
```

- `semantic` — cosine similarity between the query embedding and skill embeddings (sqlite-vec)
- `lexical` — BM25 over skill text (title + description + body) via SQLite FTS5
- Both signals are min-max normalized across the candidate set per query before fusion
- `w` is configurable (`retrieval_w`, default 0.5); pinning `w` to 0 or 1 degrades gracefully to a single signal when the other is unavailable (e.g., embedding endpoint down)
- The prior graph-adjacency term is removed from retrieval scoring; graph structure continues to serve planning/traversal

### 2. Consumption: the retrieved set seeds the top-most executor

- At most top-k most relevant skills are used, filtered by `score >= cutoff`
- The whole retrieved set becomes part of the first (top-most) TaskExecutor state — the LLM decides which skills to use, one at a time; nothing is pre-built from the set: no forward pass, no ordering, no segmentation
- Sub-skills that were not retrieved arrive during execution via the chosen skill's edges
- The library stays structure-agnostic — no connectivity requirements between skills

### Example

Goal: *"clone the repo, run the tests, fix any failures, and publish a coverage report."*

Retrieval finds `clone-repo`, `run-tests`, `ship-change`, `publish-coverage-report`, `update-readme-badge` — five skills; dev, reporting, and docs are not connected to each other (no author linked them).
- All five skills become part of the top-most executor; the LLM decides which to use — `clone-repo` first (nothing works without a repo), the docs badge last, or not at all.
- If `collect-coverage` (a prerequisite of `publish-coverage-report`) is missing everywhere, the task fails there; the gap is recorded as a `component_gap` and patched — future retrievals find it.

## Consequences

**Positive**

- Single, interpretable tuning knob; the extremes are well-defined degenerate modes (pure semantic at `w = 1`, pure lexical at `w = 0`)
- Covers both exact-match recall (BM25) and paraphrase/intent recall (embeddings)
- Graceful degradation path for either signal
- Retrieval stays one cheap step — no graph passes at task start
- Sub-skills arrive exactly when they become relevant — via the chosen skill's edges

**Negative / Risks**

- Per-query min-max normalization requires a full pass over candidates before fusion (acceptable at skill-library scale)
- Score-based fusion is sensitive to score distributions; rank-based fusion (RRF) was considered and deferred — revisit if the two signals misbehave in practice
- `w` is global; per-domain or per-skill weights are deferred as a future extension
- Execution quality depends on retrieval returning the right skills — mitigated by the hybrid scoring and by skill evolution
- A skill outside the retrieved set can never be used mid-task — it surfaces as a `component_gap` on failure and is patched for future tasks

## References

- [ADR-0002](./0002-skill-representation-filesystem-frontmatter.md) — skill files · [ADR-0004](./0004-taskmanager-recursive-execution.md) — TaskManager & recursive execution (consumes the retrieved set)
- HLD §3 (SkillRetriever), §8 — `docs/architecture/HLD.md`
- LLD §6 (Retrieval & Index), §10 (`retrieval_w`) — `docs/architecture/LLD.md`
