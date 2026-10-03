import fs from 'node:fs/promises';
import path from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { z } from 'zod';

/** A loaded agent definition — structured front matter + the procedural body. */
export interface AgentDefinition {
  id: string;
  title: string;
  description: string;
  preState: { required?: Record<string, unknown> };
  postState: { sets?: Record<string, unknown> };
  tools: string[];
  /** Which agents this one may spawn. target = another agent's id. */
  edges: Array<{
    id: string;
    target: string;
    forwardDescription: string;
    backwardDescription: string;
    condition: string;
  }>;
  metadata: { created: string };
  domain: string;
  body: string;
}

export class AgentParseError extends Error {
  constructor(
    message: string,
    readonly filePath: string,
  ) {
    super(message);
  }
}

/*
 * Runtime validation boundary: YAML front matter is external data, so TS
 * types alone can't guarantee its shape — zod is used only here.
 */
const predicateSchema = z.object({
  required: z.record(z.string(), z.unknown()).optional(),
});

const agentFileSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  preState: predicateSchema.default({}),
  postState: z
    .object({
      sets: z.record(z.string(), z.unknown()).optional(),
    })
    .default({}),
  tools: z.array(z.string()).default([]),
  edges: z
    .array(
      z.object({
        id: z.string().min(1),
        target: z.string().min(1),
        forwardDescription: z.string().default(''),
        backwardDescription: z.string().default(''),
        condition: z.string().min(1),
      }),
    )
    .default([]),
  metadata: z
    .object({
      created: z.string().default(''),
    })
    .default({}),
  body: z.string().min(1),
});

/** One agent per directory: `<agentsDir>/<domain>/<slug>/agent.md`, id = directory slug. */
export async function loadAgents(
  agentsDir: string,
): Promise<AgentDefinition[]> {
  const agents: AgentDefinition[] = [];
  for (const domain of await fs.readdir(agentsDir, { withFileTypes: true })) {
    if (!domain.isDirectory()) continue;
    for (const agentDir of await fs.readdir(path.join(agentsDir, domain.name), {
      withFileTypes: true,
    })) {
      if (!agentDir.isDirectory() || agentDir.name === domain.name) continue;
      const filePath = path.join(
        agentsDir,
        domain.name,
        agentDir.name,
        'agent.md',
      );
      agents.push(await loadAgentFile(filePath, domain.name, agentDir.name));
    }
  }
  if (agents.length === 0) {
    throw new AgentParseError(
      `No agent definitions found in ${agentsDir}`,
      agentsDir,
    );
  }
  return agents;
}

export async function loadAgentFile(
  filePath: string,
  domainName?: string,
  slugName?: string,
): Promise<AgentDefinition> {
  const text = await fs.readFile(filePath, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) {
    throw new AgentParseError(
      "Missing YAML front matter: file must start with a '---' fenced block",
      filePath,
    );
  }

  let frontMatter: unknown;
  try {
    frontMatter = loadYaml(match[1]);
  } catch (err) {
    throw new AgentParseError(
      `Invalid YAML front matter: ${err instanceof Error ? err.message : String(err)}`,
      filePath,
    );
  }
  if (frontMatter === null || typeof frontMatter !== 'object') {
    throw new AgentParseError('YAML front matter must be a mapping', filePath);
  }

  const { data, error } = agentFileSchema.safeParse({
    body: match[2],
    ...frontMatter,
  });
  if (error) {
    throw new AgentParseError(
      `Agent validation failed: ${JSON.stringify(error.issues, null, 2)}`,
      filePath,
    );
  }

  const slug = slugName ?? path.basename(path.dirname(filePath));
  if (data.id !== slug) {
    throw new AgentParseError(
      `id "${data.id}" must match the directory slug "${slug}"`,
      filePath,
    );
  }
  const domain =
    domainName ?? path.basename(path.dirname(path.dirname(filePath)));
  return { ...data, domain };
}
