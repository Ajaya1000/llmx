import type { ConversationCreateOptions } from '@earendil-works/pi-durable';
import { AgentContextDoc } from './agent-context.js';
import { createBuiltinModels } from './builtin-models.js';
import {
  ctx,
  type DurableHarnessConfig,
  getDurableHarness,
  installSpawnTool,
} from './durable-harness.js';
import { DurableAgentSession } from './durable-session.js';
import { resolveAgentModel } from './model-resolution.js';
import { createSpawnAgentTool, type SpawnHandler } from './spawn-tool.js';

export interface AgentContext {
  agentId: string;
  depth: number;
  /** Hard nesting bound mirrored into the conversation's agent context.
   */
  maxSpawnDepth?: number;
}

export interface CreateSessionParams {
  /** Working directory for project-local discovery. Default: process.cwd() */
  cwd?: string;
  /** Parent context for the durable spawn_agent tool (agentId + nesting depth). */
  agentContext?: AgentContext;
  /** Overrides for tests (storage path, fake models, extra extensions). */
  harness?: DurableHarnessConfig;
  /** When set, the `spawn_agent` tool is added to this conversation, bound to this handler. */
  spawn?: SpawnHandler;
}

/**
 * Session repository backed by @earendil-works/pi-durable + SQLite. Every call
 * creates a fresh durable conversation on the process-wide Harness — one per
 * agent — so sessions never share a parent's history by accident. Conversations,
 * model turns, tool calls, and document state are committed to storage before
 * anything is shown; a crashed process resumes from the last committed state
 * once the harness reopens.
 */
export class AgentSessionRepository {
  async createSession(
    params: CreateSessionParams = {},
  ): Promise<DurableAgentSession> {
    const harness = await getDurableHarness(params.harness);

    const model = await resolveAgentModel(
      params.harness?.models ?? (await createBuiltinModels()),
    );

    // pi-durable offers tools through registry extensions — the conversation's
    // `agent.tools` only FILTERS those. Without the install, the filter matches
    // nothing and the model is offered no tools at all.
    const spawnTool = params.spawn
      ? createSpawnAgentTool(params.spawn)
      : undefined;
    if (spawnTool) await installSpawnTool(spawnTool);

    const conversationOption: ConversationCreateOptions = {
      ownership: { kind: 'ownerless' },
      agent: {
        model: { provider: model.provider, modelId: model.id },
        ...(params.cwd ? { cwd: params.cwd } : {}),
        // An array offers exactly these extension-provided tools; an empty
        // list offers none — leaf agents (and conversations without a spawn
        // handler) must not even see spawn_agent.
        tools: spawnTool ? [spawnTool] : [],
      },
      init: async (tx, conversationId) => {
        if (!params.agentContext) return;
        const agentContextDoc = await tx.doc(AgentContextDoc, conversationId);

        agentContextDoc.agentId = params.agentContext.agentId;
        agentContextDoc.depth = params.agentContext.depth;
      },
    };

    const conversation = await harness.createConversation(
      conversationOption,
      ctx,
    );

    return new DurableAgentSession(harness, conversation);
  }
}
