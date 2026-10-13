# Evolution Trajectory Restructure Plan

## Goal

Replace the nested run/step trajectory with the flow structure in [evolution-arch.human.md](./evolution-arch.human.md): a flow description, item definitions, and one ordered, flat trace. Each `itemRef` identifies who produced the trace. LLM messages and tool definitions follow the official OpenAI Chat Completions types.

## Models to create

Pseudocode for the in-memory model. OpenAI message and tool types come from the official SDK; use its exact shapes rather than redefining them.

```ts
type ItemRef = string;

type DefinitionItem =
  | LlmDefinition
  | UserDefinition
  | ToolDefinition
  | CodeDefinition;

interface LlmDefinition {
  id: ItemRef;
  type: 'llm';
  systemPrompt?: string;
  description?: string;
  model?: { provider: string; modelId: string };
  tools: ChatCompletionTool[];
}

interface UserDefinition {
  id: ItemRef;
  type: 'user';
  description?: string;
}

interface ToolDefinition {
  id: ItemRef;
  type: 'tool';
  name: string;
  description?: string;
  params: unknown;
}

interface CodeDefinition {
  id: ItemRef;
  type: 'code';
  description?: string;
  params?: unknown;
}

type Trace = LlmTrace | UserTrace | ToolTrace | CodeTrace;

interface LlmTrace {
  itemRef: ItemRef; // references LlmDefinition
  overridenTool?: ChatCompletionTool[];
  message: ChatCompletionMessageParam;
}

interface UserTrace {
  itemRef: ItemRef; // references UserDefinition
  message: string | ChatCompletionUserMessageParam; // text or OpenAI multimodal input
}

interface ToolTrace {
  itemRef: ItemRef; // references ToolDefinition
  output: { tool_call_id: string; content: unknown; isError?: boolean };
}

interface CodeTrace {
  itemRef: ItemRef; // references CodeDefinition
  output: unknown;
}

interface Trajectory {
  flow: string; // contents of flow.md
  definition: DefinitionItem[];
  traces: Trace[]; // chronological; child-agent traces are flattened here
}
```

The trajectory is format-neutral apart from its OpenAI Chat Completions message and tool shapes. Validate that every `itemRef` resolves to a definition item of a compatible type.

## Example

```json
{
  "definition": [
    {
      "id": "research_agent",
      "type": "llm",
      "systemPrompt": "Research the user's question.",
      "description": "Research agent",
      "tools": [{
        "type": "function",
        "function": {
          "name": "search",
          "description": "Search the web",
          "parameters": { "type": "object", "properties": { "query": { "type": "string" } } }
        }
      }]
    },
    { "id": "human_1", "type": "user" },
    { "id": "tool:search", "type": "tool", "name": "search", "description": "Web search", "params": {} }
  ],
  "traces": [
    { "itemRef": "human_1", "message": "Find recent research on this topic." },
    {
      "itemRef": "research_agent",
      "message": {
        "role": "assistant",
        "content": null,
        "tool_calls": [{
          "id": "call_1",
          "type": "function",
          "function": { "name": "search", "arguments": "{\\"query\\":\\"recent research\\"}" }
        }]
      }
    },
    {
      "itemRef": "tool:search",
      "output": { "tool_call_id": "call_1", "content": "Search results...", "isError": false }
    },
    {
      "itemRef": "research_agent",
      "message": { "role": "assistant", "content": "Here is the summary." }
    }
  ]
}
```

The example shows the key relationships: tool calls remain in the assistant's OpenAI message; the tool's output is a separate trace linked by call ID; the ordered list preserves the flow. In production, `overridenTool` should use the agreed OpenAI tool-definition shape and be omitted when no override applies.

## Plan

1. **Map all trace data.** Normalize LLM messages and tool definitions to official OpenAI Chat Completions shapes. Keep the trajectory contract generic; do not add producer-specific fields.
2. **Define the trajectory contract.** Model flow definitions and flat trace variants. Derive stable trace references, rendered contexts, and agent relationships from the sequence—do not nest child trajectories in trace steps.
3. **Update producers and adapters.** Emit the same structural model using official OpenAI SDK types. Preserve item identity, tool-call/result linkage, and child-agent ordering when flattening.
4. **Migrate consumers and tests.** Update pinpointing, distillation, runtime, exports, and fixtures that assume nested steps. Verify JSON round-trips and preservation of all supported message, tool-call, and output fields.
5. **Validate.** Check for external or persisted consumers; if historical records exist, provide an explicit versioned adapter. Run the relevant typecheck, test, and formatting commands.

## Acceptance criteria

- Every `itemRef` resolves to one compatible definition item; traces remain in execution order.
- LLM messages and tool declarations use official OpenAI Chat Completions types.
- Tool-call/result linkage and spawned-agent ordering survive flattening.
- All fields supported by the target model survive serialization without loss.
- Pinpointing and distillation work against the new flat model and are covered by tests.
