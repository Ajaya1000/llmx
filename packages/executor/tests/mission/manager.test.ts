import { describe, expect, it } from 'vitest';
import type { AgentDefinition } from '../../src/agent/agents.ts';
import { MissionManager, MissionUIType } from '../../src/mission/manager.ts';
import type { Mission } from '../../src/types.ts';

/** A hand-built entry is cast so the runtime guard can be exercised. */
function manager(entry: unknown): MissionManager {
  return new MissionManager({
    uiType: MissionUIType.LOG,
    mission: {
      goal: 'g',
      entry: entry as Mission['entry'],
    },
  });
}

describe('MissionManager entry validation', () => {
  it('accepts an entry agent given as a roster id', () => {
    expect(manager({ agent: 'explore', task: 't' })).toBeInstanceOf(
      MissionManager,
    );
  });

  it('accepts an entry agent given as a definition', () => {
    expect(manager({ agent: def('explore'), task: 't' })).toBeInstanceOf(
      MissionManager,
    );
  });

  it('refuses an entry without an agent', () => {
    expect(() => manager({ task: 't' })).toThrow(
      /agent is required \(a roster id or a definition\)/,
    );
  });
});

function def(id: string): AgentDefinition {
  return {
    id,
    title: id,
    description: 'test agent',
    preState: {},
    postState: {},
    tools: [],
    edges: [],
    metadata: { created: '' },
    domain: 'test',
    body: '',
  };
}
