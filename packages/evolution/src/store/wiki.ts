import type { Pinpointer } from '../pinpoint.ts';
import type { WikiPort } from '../ports.ts';
import type { Ref } from '../types.ts';
import type { Blame, WikiRow } from '../wiki-types.ts';
import { DefaultRetentionPolicy, type RetentionPolicy } from './retention.ts';
import type { WikiPersistence } from './wiki-persistence.ts';

/** The wiki — curated, time-framed, bounded store of distilled judgments,
 * accumulated across runs. */
export interface WikiMaintainer extends WikiPort {
  /** Every held row — the prior knowledge the wiki agent searches across. */
  rows(): WikiRow[];
}

/**
 * WikiMaintainer backed by any WikiPersistence. Pinpointing delegates to the
 * injected Pinpointer; prioritized failures use the retention policy.
 */
export class DefaultWikiMaintainer implements WikiMaintainer {
  private rowsById = new Map<Ref, WikiRow>();

  constructor(
    private readonly pinpointer: Pinpointer,
    private readonly persistence: WikiPersistence,
    private readonly retention: RetentionPolicy = new DefaultRetentionPolicy(),
  ) {
    for (const row of this.persistence.load()) this.rowsById.set(row.id, row);
  }

  record(row: WikiRow): void {
    this.rowsById.set(row.id, row);
    this.persistence.save(row);
  }

  pinpoint(fact: string): Blame | null {
    return this.pinpointer.pinpoint(fact);
  }

  rows(): WikiRow[] {
    return [...this.rowsById.values()];
  }

  prioritizedFailures(k?: number): WikiRow[] {
    const failures = [...this.rowsById.values()].filter(
      (row) => row.kind === 'failure',
    );
    return this.retention.topK(failures, k ?? failures.length);
  }
}
