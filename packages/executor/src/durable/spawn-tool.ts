import {
  defineTool,
  type ToolExecutionResult,
  type ToolRegistration,
} from '@earendil-works/pi-durable';
import { type Static, Type } from 'typebox';
import { AgentContextDoc } from './agent-context.ts';

export const SpawnParams = Type.Object({
  agent: Type.String({
    description:
      "Id of a loaded agent definition to run (e.g. explore). Its procedure becomes the child's protocol; `task` is the caller's input.",
  }),
  task: Type.String({
    description: 'Input passed to the spawned agent.',
  }),
});

export type SpawnInput = Static<typeof SpawnParams> & {
  parentAgentId: string;
  parentDepth: number;
};

/**
 * The port the durable tool calls; implemented by the mission layer's
 * factory. Injected per conversation via `agent.tools`, so no process-wide
 * state and no cycle back into the harness.
 */
export type SpawnHandler = (input: SpawnInput) => Promise<string | undefined>;

/**
 * Builds the `spawn_agent` tool bound to `handler`. The caller (a session's
 * creator) injects it into the conversation via `agent.tools`; absent that,
 * the conversation simply has no `spawn_agent` tool.
 */
export function createSpawnAgentTool(handler: SpawnHandler): ToolRegistration {
  return defineTool({
    name: 'spawn_agent',
    description:
      'Spawn a sub-agent for a delegated task. Pass `agent` (a definition id). The child runs under its declared ' +
      'procedure with `task` as input and a fresh context. Its final summary is returned as the tool result.',
    parameters: SpawnParams,
    execute: async (args, api, context): Promise<ToolExecutionResult> => {
      const parent = await api.snapshot(
        AgentContextDoc,
        api.conversationId,
        context,
      );
      try {
        const text = await handler({
          parentAgentId: parent?.agentId ?? 'unknown',
          parentDepth: parent?.depth ?? 0,
          agent: args.agent,
          task: args.task,
        });
        if (text === undefined) {
          return {
            content: [{ type: 'text', text: 'Agent produced no output.' }],
          };
        }
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        const e = err as Error;
        return {
          content: [{ type: 'text', text: `Spawn failed: ${e.message}` }],
          isError: true,
        };
      }
    },
  });
}
