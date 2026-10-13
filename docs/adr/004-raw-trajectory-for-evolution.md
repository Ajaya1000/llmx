# ADR-0004: The executor returns the whole raw trajectory

**Date:** 2026-09-28
**Status:** Proposed

## Context

Evolution ([WIRING.md](../../packages/evolution/WIRING.md)) needs real content, not summaries: `TranscriptRecord`s carry what fact-matching searches, and `context_injection` records are where it gets each context's content — the tool descriptions the model was actually offered, the seed it was prompted with, everything. If the executor throws any of that away on the way out, evolution can never recover it.

The trajectory we returned was a distilled view. System messages were skipped, empty text dropped, tool results flattened to a string, and the tool set given to each agent was recorded nowhere. Worse, a probe of the real harness showed `spawn_agent` was never actually offered to the model at all: pi-durable treats `agent.tools` as a name filter over extension-provided tools, and we had registered no extension — so the filter matched nothing. The fake-session tests never noticed because they bypass the harness.

## Decision

The executor returns the trajectory raw, per agent, recursively nested:

- **`transcript`** — the conversation's raw model context, verbatim, from the system message (which pi-durable writes with the offered tools' declarations) to the last message. Nothing filtered, nothing flattened. This is the substrate evolution derives `TranscriptRecord`s from.
- **`context`** — the resolved run context: the model, every tool the model was offered (name, description, parameters), and the instructions. This is what evolution derives `contextsUsed` / `context_injection` from, and the record of what each agent was actually given.
- **`steps`** — a derived, lossless ordered view (every block survives; a spawned agent's whole trajectory nests under its `spawn_agent` step, matched by tool call id). For readability and rendering; `transcript` remains the source of truth.

Two supporting fixes:

- The `spawn_agent` tool is installed as a registry extension so conversations can actually offer it; the leaf/no-spawn case sets an explicit empty tool filter.
- The `ToolCall` step keeps its flattened `result` text as a readability summary only — the raw tool result lives in `transcript`.

## Consequences

The returned trajectory is large and includes reasoning, but it is the point: evolution judges what actually happened, and the durable store already holds the raw entries, so this changes the in-memory return contract, not persistence. The `steps` view stays small enough for humans; anything else renders from `transcript`.

The harness is a process-wide singleton, so installing the spawn extension binds one handler per process — one active mission per process. That is today's reality anyway (the mission manager closes the harness on exit); it is noted in the source and revisited if missions ever run concurrently in one process.

## References

- [ADR-0002](./002-taskmanager-recursive-execution.md) — execution history, one session per executor
- [ADR-0003](./003-pi-durable-task-graph-substrate.md) — the durable substrate
- [Evolution framework HLD/LLD](../architecture/evolution-framework.md) — what consumes this

```json
{
  "agentId": "agent:writer",
  "task": "Draft the quarterly harbor report",
  "depth": 0,
  "context": {
    "model": {
      "provider": "openai",
      "modelId": "gpt-4o-mini"
    },
    "tools": [
      {
        "name": "search_docs",
        "description": "Full-text search over the harbor archive.",
        "parameters": {
          "type": "object",
          "properties": {
            "query": { "type": "string" },
            "limit": { "type": "number", "default": 5 }
          },
          "required": ["query"]
        }
      },
      {
        "name": "spawn_editor",
        "description": "Spawn a child editor agent to revise a draft.",
        "parameters": {
          "type": "object",
          "properties": {
            "draft": { "type": "string" }
          },
          "required": ["draft"]
        }
      }
    ],
    "instructions": "You are a careful harbor writer. Verify every claim against the archive."
  },
  "steps": [
    {
      "role": "system",
      "content": "You are a careful harbor writer. Verify every claim against the archive."
    },
    {
      "role": "system",
      "content": [
        { "type": "text", "text": "Mid-run update: tide-table tool is now available." },
        { "type": "image" }
      ],
      "toolsAdded": [
        {
          "name": "tide_table",
          "description": "Look up tide times by date.",
          "parameters": {
            "type": "object",
            "properties": {
              "date": { "type": "string", "format": "date" }
            },
            "required": ["date"]
          }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Write the Q3 summary, keep it under 200 words." }
      ]
    },
    {
      "type": "thinking",
      "thinking": "I should search the archive for Q3 events before drafting."
    },
    {
      "type": "toolCall",
      "id": "call_01",
      "name": "search_docs",
      "arguments": { "query": "harbor Q3 events", "limit": 3, "exact": false, "tags": ["q3", "events"], "boost": null },
      "result": "Found 3 entries: regatta (Jul 12), pier repair (Aug 4), night market (Sep 19).",
      "isError": false
    },
    {
      "type": "toolCall",
      "id": "call_02",
      "name": "tide_table",
      "arguments": { "date": "2026-13-40" },
      "result": "Invalid date: month 13 out of range.",
      "isError": true
    },
    {
      "type": "text",
      "text": "Draft: Q3 saw the regatta, pier repairs, and a record night market."
    },
    {
      "type": "toolCall",
      "id": "call_03",
      "name": "spawn_editor",
      "arguments": { "draft": "Q3 saw the regatta, pier repairs, and a record night market." },
      "result": "Editor revised the draft.",
      "isError": false,
      "child": {
        "agentId": "agent:editor",
        "task": "Revise the Q3 draft",
        "depth": 1,
        "context": {
          "tools": [],
          "instructions": "You are a terse editor. Fix grammar only."
        },
        "steps": [
          {
            "role": "system",
            "content": "You are a terse editor. Fix grammar only."
          },
          {
            "role": "user",
            "content": "Revise: Q3 saw the regatta, pier repairs, and a record night market."
          },
          {
            "type": "text",
            "text": "Revised: Q3 featured the regatta, pier repairs, and a record night market."
          }
        ]
      }
    }
  ]
}
```