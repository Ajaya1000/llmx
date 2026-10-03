import { describe, expect, it } from 'vitest';
import { MissionAgent } from '../src/agent/agent.js';
import type { AgentDefinition } from '../src/agent/agents.js';
import { loadAgents } from '../src/agent/agents.js';
import { EnvironmentImpl } from '../src/mission/environment.js';

function bareDef(
  overrides: Partial<AgentDefinition> & { id: string },
): AgentDefinition {
  return {
    title: overrides.id,
    description: 'test agent',
    preState: {},
    postState: {},
    tools: [],
    edges: [],
    metadata: { created: '' },
    domain: 'test',
    body: 'do the thing',
    ...overrides,
  };
}

function spawnToolOf(agent: MissionAgent): {
  execute: (
    id: string,
    params: { agent?: string; task: string },
  ) => Promise<{ content: { text: string }[] }>;
} {
  const tool = (
    agent as unknown as {
      spawnAgentTool(): {
        execute: (
          i: string,
          p: unknown,
        ) => Promise<{ content: { text: string }[] }>;
      };
    }
  ).spawnAgentTool();
  return tool;
}

describe('agent definitions', () => {
  it('loads the demo debug mission agents under agents/<domain>/<slug>', async () => {
    const defs = await loadAgents('../LLMxDemo/agents');
    expect(defs.map((d) => d.id).sort()).toEqual([
      'debug-agent',
      'explore',
      'hypothesize',
      'verify',
    ]);
    const debug = defs.find((d) => d.id === 'debug-agent')!;
    expect(debug.domain).toBe('debug');
    expect(debug.edges.map((e) => e.target)).toEqual([
      'explore',
      'hypothesize',
      'verify',
    ]);
    expect(debug.body).toContain('explore');
  });
});

describe('edge policy', () => {
  it("refuses spawning agents outside the parent's declared edges", async () => {
    const debugAgent = bareDef({
      id: 'debug-agent',
      edges: [
        {
          id: 'e1',
          target: 'explore',
          forwardDescription: '',
          backwardDescription: '',
          condition: 'start == true',
        },
      ],
    });
    const agent = new MissionAgent({
      agentId: 'agent-1',
      goal: 'g',
      task: 't',
      environment: new EnvironmentImpl(),
      agentDefs: [bareDef({ id: 'explore' }), bareDef({ id: 'rogue' })],
      definition: debugAgent,
      parent: null,
      depth: 0,
      maxSpawnDepth: 8,
    });

    const result = await spawnToolOf(agent).execute('call-1', {
      agent: 'rogue',
      task: 'nope',
    });
    expect(result.content[0].text).toContain('may only spawn [explore]');
  });

  it('accepts an unknown agent id as a clear error', async () => {
    const agent = new MissionAgent({
      agentId: 'agent-1',
      goal: 'g',
      task: 't',
      environment: new EnvironmentImpl(),
      agentDefs: [],
      parent: null,
      depth: 0,
      maxSpawnDepth: 8,
    });
    const result = await spawnToolOf(agent).execute('call-1', {
      agent: 'ghost',
      task: 't',
    });
    expect(result.content[0].text).toContain('Unknown agent id');
  });
});
