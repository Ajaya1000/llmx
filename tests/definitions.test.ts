import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AgentParseError,
  loadAgentFile,
  loadAgents,
} from '../src/agent/agents.ts';

let dir: string;

function agentMd(
  overrides: {
    id?: string;
    title?: string;
    description?: string;
    edges?: Array<Record<string, unknown>>;
    body?: string;
  } = {},
): string {
  const frontMatter: Record<string, unknown> = {
    id: overrides.id ?? 'explore',
    title: overrides.title ?? 'Explore',
    description: overrides.description ?? 'explores the repo',
    tools: [],
    ...overrides,
  };
  delete frontMatter.body;
  const body = overrides.body ?? 'Look around and report back.';
  return `---\n${JSON.stringify(frontMatter, null, 2)}\n---\n${body}`;
}

async function writeAgent(
  domain: string,
  slug: string,
  file: string,
): Promise<string> {
  const path = join(dir, domain, slug);
  await mkdir(path, { recursive: true });
  const filePath = join(path, 'agent.md');
  await writeFile(filePath, file);
  return filePath;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'llmx-agents-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('loadAgents', () => {
  it('loads demo agents under agents/<domain>/<slug> with ids, domain, and edges in order', async () => {
    await writeAgent(
      'debug',
      'debug-agent',
      agentMd({
        id: 'debug-agent',
        title: 'Debug',
        description: 'coordinates a debug mission',
        edges: [
          {
            id: 'e1',
            target: 'explore',
            forwardDescription: 'fan out evidence gathering',
            backwardDescription: 'reports findings',
            condition: 'program == "biz"',
          },
          {
            id: 'e2',
            target: 'hypothesize',
            forwardDescription: 'draft hypothesis',
            backwardDescription: 'returns hypothesis',
            condition: 'has_evidence == true',
          },
          {
            id: 'e3',
            target: 'verify',
            forwardDescription: 'confirm hypothesis',
            backwardDescription: 'verdict',
            condition: 'hypothesis_ready == true',
          },
        ],
        body: 'Run explore, then hypothesize, then verify.',
      }),
    );
    await writeAgent('debug', 'explore', agentMd({ id: 'explore' }));
    await writeAgent('debug', 'verify', agentMd({ id: 'verify' }));
    await writeAgent('debug', 'hypothesize', agentMd({ id: 'hypothesize' }));

    const defs = await loadAgents(dir);
    expect(defs.map((d) => d.id).sort()).toEqual([
      'debug-agent',
      'explore',
      'hypothesize',
      'verify',
    ]);

    const debug = defs.find((d) => d.id === 'debug-agent');
    expect(debug).toBeDefined();
    if (!debug) throw new Error('debug-agent definition missing');
    expect(debug.domain).toBe('debug');
    expect(debug.edges.map((e) => e.target)).toEqual([
      'explore',
      'hypothesize',
      'verify',
    ]);
    expect(debug.body).toContain('Run explore, then hypothesize, then verify.');
    expect(defs.find((d) => d.id === 'explore')?.domain).toBe('debug');
  });

  it('is empty-tolerant about non-directory entries and throws when no agents exist', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'llmx-agents-empty-'));
    try {
      await mkdir(join(empty, 'none'), { recursive: true });
      await writeFile(
        join(empty, 'root.md'),
        'a straggler file, not a domain directory',
      );

      try {
        await loadAgents(empty);
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AgentParseError);
        expect((err as AgentParseError).message).toMatch(
          /^No agent definitions found in/,
        );
        expect((err as AgentParseError).filePath).toBe(empty);
      }
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it('rejects an id that does not match its directory slug', async () => {
    const filePath = await writeAgent(
      'debug',
      'explore',
      agentMd({ id: 'mismatch' }),
    );
    try {
      await loadAgentFile(filePath);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentParseError);
      expect((err as AgentParseError).message).toContain(
        'id "mismatch" must match the directory slug "explore"',
      );
    }
  });

  it('rejects files without YAML front matter', async () => {
    const filePath = await writeAgent('debug', 'naked', 'just a bare body');
    try {
      await loadAgentFile(filePath);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentParseError);
      expect((err as AgentParseError).message).toContain(
        'Missing YAML front matter',
      );
    }
  });

  it('loadAgentFile honours explicit domain and slug names', async () => {
    const filePath = await writeAgent(
      'debug',
      'explore',
      agentMd({ id: 'explore' }),
    );
    const def = await loadAgentFile(filePath, 'mission-domain', 'explore');
    expect(def.domain).toBe('mission-domain');
    expect(def.title).toBe('Explore');
    expect(def.body).toContain('Look around and report back.');
  });
});
