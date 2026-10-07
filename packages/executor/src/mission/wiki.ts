import { randomUUID } from 'node:crypto';
import type { WikiEntry, WikiEntryKind, WikiMaintainer } from '../types.ts';

/** Minimal WikiMaintainer: lessons recorded in memory; slates ingested for later distillation. */
export class InMemoryWikiMaintainer implements WikiMaintainer {
  private entries: WikiEntry[] = [];
  recordEntry(
    agentId: string,
    kind: WikiEntryKind,
    content: string,
  ): WikiEntry {
    const entry: WikiEntry = {
      id: randomUUID(),
      kind,
      agentId,
      content,
      createdAt: Date.now(),
    };
    this.entries.push(entry);
    return entry;
  }

  lessons(): WikiEntry[] {
    return this.entries.filter((entry) => entry.kind === 'lesson');
  }

  /** Every recorded entry — consumed by the SkillProposer's distillation input. */
  allEntries(): WikiEntry[] {
    return [...this.entries];
  }
}
