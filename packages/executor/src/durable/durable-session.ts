import { randomUUID } from 'node:crypto';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type {
  AgentEvent,
  AgentEventStream,
  Conversation,
  Harness,
} from '@earendil-works/pi-durable';
import { watchEvents } from '@earendil-works/pi-durable';

/** Context passed to every pi-durable call. */
const ctx = BACKGROUND_CONTEXT;

/** Loose session surface consumed by TaskExecutor (replaces the pi-coding-agent AgentSession). */
export interface AgentSessionLike {
  /** The durable transcript in model-context order; refreshed after prompt(). */
  readonly messages: AgentMessage[];
  getLastAssistantText(): string | undefined;
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  /** Durably admits the input as a submission and waits until it is answered or failed. */
  prompt(text: string): Promise<void>;
  /** Detaches event listeners. The durable transcript stays in storage. */
  dispose(): void;
}

/** Loose event shape consumed by MissionUi implementations. */
export interface AgentSessionEvent {
  type: string;
  toolName?: string;
  delta?: string;
}

export interface DurableSessionOptions {
  /** Working directory recorded on the durable agent state. */
  cwd?: string;
  /** Per-conversation parent context written in the creating commit. */
  agentContext?: { agentId: string; depth: number; maxSpawnDepth?: number };
}

/** AgentSession backed by a pi-durable Harness conversation committed to storage. */
export class DurableAgentSession implements AgentSessionLike {
  messages: AgentMessage[] = [];
  private listeners = new Set<(event: AgentSessionEvent) => void>();
  /** Events observed before any subscriber attached. */
  private pending: AgentSessionEvent[] = [];
  private stream?: AgentEventStream;

  constructor(
    public readonly harness: Harness,
    readonly conversation: Conversation,
  ) {
    void this.attachEvents();
  }

  getLastAssistantText(): string | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i];
      if (message.role !== 'assistant') continue;
      const text = message.content
        .filter((block) => block.type === 'text')
        .map((block) => ('text' in block ? block.text : ''))
        .join('\n')
        .trim();
      return text.length > 0 ? text : undefined;
    }
    return undefined;
  }

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    this.listeners.add(listener);
    // Deliver any events observed before this subscriber attached, in order.
    for (const event of this.pending.splice(0)) this.deliver(event);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async prompt(text: string): Promise<void> {
    this.messages = [];
    const submission = await this.conversation.submit(
      { type: 'input', content: text, requestId: randomUUID() },
      ctx,
    );
    const settled = await submission.wait(ctx);
    if (settled.status !== 'done') {
      throw new Error(`Agent prompt failed: ${JSON.stringify(settled)}`);
    }
    this.messages = await this.conversation
      .context(ctx)
      .then((view) => view.messages as AgentMessage[]);
  }

  dispose(): void {
    this.listeners.clear();
    this.stream?.stop();
    this.stream = undefined;
  }

  // ---------------------------------------------------------------- privates

  private deliver(event: AgentSessionEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private async attachEvents(): Promise<void> {
    const stream = await watchEvents(this.harness, this.conversation.id, ctx);
    this.stream = stream;
    stream.start(async (events) => {
      for (const event of events) {
        this.dispatch(event);
      }
    });
  }

  private dispatch(event: AgentEvent): void {
    if (
      event.type === 'tool_execution_start' ||
      event.type === 'tool_execution_end'
    ) {
      this.deliver({ type: event.type, toolName: event.toolName });
    }
  }
}
