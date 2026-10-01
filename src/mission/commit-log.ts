import type { CommitStore, WorkingSlate } from '../types.js';

/**
 * In-memory working-state commit store, shared across the agents of one
 * mission via their Environment. Nothing is persisted on its own across
 * sessions; the WikiMaintainer may distill from it at teardown.
 */
export class CommitLog implements CommitStore {
  private readonly slates: WorkingSlate[] = [];

  commit(
    agentId: string,
    content: Record<string, unknown>,
    note?: string
  ): WorkingSlate {
    const slate: WorkingSlate = {
      agentId,
      committedAt: Date.now(),
      content: { ...content },
      ...(note !== undefined ? { note } : {}),
    };
    this.slates.push(slate);
    return slate;
  }

  all(): WorkingSlate[] {
    return [...this.slates];
  }

  byAgent(agentId: string): WorkingSlate[] {
    return this.slates.filter((slate) => slate.agentId === agentId);
  }
}
