import { describe, expect, it } from 'vitest';
import { CommitLog } from '../src/mission/commit-log.js';
import { EnvironmentImpl } from '../src/mission/environment.js';
import { InMemoryWikiMaintainer } from '../src/mission/wiki.js';
import { MissionAgent } from '../src/agent/agent.js';

describe('CommitLog', () => {
  it('commits and reads working slates in order', () => {
    const log = new CommitLog();
    const a = log.commit('agent-1', { repo_cloned: true });
    const b = log.commit('agent-2', { tests: 'green' }, 'final');

    expect(log.all()).toEqual([a, b]);
    expect(a.content).toEqual({ repo_cloned: true });
    expect(b.note).toBe('final');
    expect(log.byAgent('agent-2')).toHaveLength(1);
    expect(new Set(log.all().map((s) => s.committedAt > 0))).toEqual(
      new Set([true])
    );
  });
});

describe('InMemoryWikiMaintainer', () => {
  it('hands lessons back and ingests slates', () => {
    const wiki = new InMemoryWikiMaintainer();
    wiki.recordEntry('agent-1', 'lesson', 'always stash before rebase');
    wiki.recordEntry('agent-1', 'failure', 'detached HEAD');

    const slate = { agentId: 'agent-1', committedAt: 1, content: { x: 1 } };
    wiki.recordSlate(slate);

    expect(wiki.lessons()).toHaveLength(1);
    expect(wiki.allEntries()).toHaveLength(2);
    expect(wiki.allSlates()).toEqual([slate]);
  });
});

describe('EnvironmentImpl', () => {
  it('describes properties and lessons for the seed prompt', () => {
    const env = new EnvironmentImpl({ properties: { cwd: '/repo' } });
    env.wiki.recordEntry('agent-1', 'lesson', 'check the lockfile');
    env.commits.commit('agent-1', { ready: true });

    const describe = env.describe();
    expect(describe).toContain('cwd: /repo');
    expect(describe).toContain('check the lockfile');
  });
});

describe('MissionAgent tools', () => {
  it('refuses spawn_agent at the depth limit', async () => {
    const env = new EnvironmentImpl();
    const agent = new MissionAgent({
      agentId: 'agent-1',
      goal: 'ship',
      task: 'test',
      environment: env,
      parent: null,
      depth: 8,
      maxSpawnDepth: 8,
    });

    const tool = (
      agent as unknown as {
        spawnAgentTool(): {
          execute: (
            id: string,
            params: { task: string }
          ) => Promise<{ content: { text: string }[] }>;
        };
      }
    ).spawnAgentTool();
    const result = await tool.execute('call-1', { task: 'delegate more' });

    expect(result.content[0].text).toContain('nesting depth limit');
  });

  it('commit_state writes into the shared environment', async () => {
    const env = new EnvironmentImpl();
    const agent = new MissionAgent({
      agentId: 'agent-1',
      goal: 'ship',
      task: 'test',
      environment: env,
      parent: null,
      depth: 0,
      maxSpawnDepth: 8,
    });

    const tool = (
      agent as unknown as {
        commitStateTool(): {
          execute: (
            id: string,
            params: { content: Record<string, unknown> }
          ) => Promise<unknown>;
        };
      }
    ).commitStateTool();
    await tool.execute('call-1', { content: { branch: 'main' } });

    expect(env.commits.all()).toHaveLength(1);
    expect(env.commits.all()[0].content).toEqual({ branch: 'main' });
    expect(env.commits.all()[0].agentId).toBe('agent-1');
  });
});
