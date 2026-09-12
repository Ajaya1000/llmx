# ADR-0001: Weighted-average hybrid retrieval (semantic + BM25)

**Date:** 2026-09-12
**Status:** Accepted

## Context

The `SkillRetriever` must rank candidate skills for a given goal and current task state. Pure vector search misses exact keyword matches (identifiers, error codes, CLI flags); pure lexical search misses paraphrases and intent. An earlier design draft used a three-term score (`0.5·cosine + 0.3·keyword + 0.2·graph_adjacency`) whose weights were ad hoc, did not sum to 1, and offered no principled way to tune or degrade.

## Decision

Retrieve via hybrid search that fuses semantic and lexical signals with a weighted average:

```
score = w·semantic + (1-w)·lexical,  0 ≤ w ≤ 1
```

- `semantic` — cosine similarity between the query embedding and skill embeddings (sqlite-vec)
- `lexical` — BM25 over skill text (title + description + body) via SQLite FTS5
- Both signals are min-max normalized across the candidate set per query before fusion
- `w` is configurable (`retrieval_w`, default 0.5); pinning `w` to 0 or 1 degrades gracefully to a single signal when the other is unavailable (e.g., embedding endpoint down)
- The prior graph-adjacency term is removed from retrieval scoring; graph structure continues to serve planning/traversal

## Consequences

**Positive**

- Single, interpretable tuning knob; the extremes are well-defined degenerate modes (pure semantic at `w = 1`, pure lexical at `w = 0`)
- Covers both exact-match recall (BM25) and paraphrase/intent recall (embeddings)
- Graceful degradation path for either signal

**Negative / Risks**

- Per-query min-max normalization requires a full pass over candidates before fusion (acceptable at skill-library scale)
- Score-based fusion is sensitive to score distributions; rank-based fusion (RRF) was considered and deferred — revisit if the two signals misbehave in practice
- `w` is global; per-domain or per-skill weights are deferred as a future extension

## References

- HLD §3 (SkillRetriever), §8 — `docs/architecture/HLD.md`
- LLD §6 (Retrieval & Index), §10 (`retrieval_w`) — `docs/architecture/LLD.md`
