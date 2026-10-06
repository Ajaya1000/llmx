import type { Author, Ref } from './types.ts';
import type { WikiRow } from './wiki-types.ts';

/**
 * Back-pressure: a correction authored against one blamed ref, pushed
 * edge-by-edge (never whole-graph). Produces a `back_pressure` row for the wiki.
 */
export interface BackPressure {
  push(blamedRef: Ref, correction: Ref, author: Author): WikiRow;
}

export class DefaultBackPressure implements BackPressure {
  push(blamedRef: Ref, correction: Ref, author: Author): WikiRow {
    const now = Date.now();
    return {
      // ponytail: missionId is '' until back-pressure is wired to a mission.
      id: `bp:${blamedRef}:${correction}`,
      missionId: '',
      kind: 'back_pressure',
      author,
      refs: { blamedRef, correctionRef: correction },
      content: '',
      useCount: 0,
      lastUsedAt: now,
      createdAt: now,
    };
  }
}
