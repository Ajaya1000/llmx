import fs from 'node:fs/promises';
import path from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { z } from 'zod';
import type { Skill } from './schema.js';

export class SkillParseError extends Error {
  constructor(
    message: string,
    readonly filePath: string
  ) {
    super(message);
  }
}

export interface RawSkillFile {
  frontMatter: Record<string, unknown>;
  body: string;
}

/*
 * Runtime validation boundary: YAML front matter is external data, so TS
 * types alone can't guarantee its shape — zod is used only here.
 */
const predicateSchema = z.object({
  required: z.record(z.string(), z.unknown()).optional(),
});

const frontMatterSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  preState: predicateSchema.default({}),
  postState: z
    .object({
      sets: z.record(z.string(), z.unknown()).optional(),
    })
    .default({}),
  tools: z.array(z.string()).default([]),
  testSuite: z.string().optional(),
  edges: z
    .array(
      z.object({
        id: z.string().min(1),
        target: z.string().min(1),
        forwardDescription: z.string().default(''),
        backwardDescription: z.string().default(''),
        condition: z.string().min(1),
      })
    )
    .default([]),
  metadata: z
    .object({
      created: z.string().default(''),
      stats: z
        .object({
          runs: z.number().int().nonnegative().default(0),
          success_rate: z.number().min(0).max(1).default(0.0),
        })
        .default({ runs: 0, success_rate: 0.0 }),
    })
    .default({ created: '', stats: { runs: 0, success_rate: 0.0 } }),
});

/**
 * Split a skill.md file into YAML front matter and the Markdown body.
 * Front matter must be the first thing in the file, fenced by "---" lines.
 */
export async function parseSkillFile(filePath: string): Promise<RawSkillFile> {
  const text = await fs.readFile(filePath, 'utf8');
  return parseSkillText(text, filePath);
}

export function parseSkillText(
  text: string,
  filePath = '<inline>'
): RawSkillFile {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) {
    throw new SkillParseError(
      "Missing YAML front matter: file must start with a '---' fenced block",
      filePath
    );
  }
  const [, head, body] = match;
  let frontMatter: unknown;
  try {
    frontMatter = loadYaml(head);
  } catch (err) {
    throw new SkillParseError(
      `Invalid YAML front matter: ${err instanceof Error ? err.message : String(err)}`,
      filePath
    );
  }
  if (frontMatter === null || typeof frontMatter !== 'object') {
    throw new SkillParseError('YAML front matter must be a mapping', filePath);
  }
  return {
    frontMatter: frontMatter as Record<string, unknown>,
    body: body ?? '',
  };
}

/**
 * Parse + validate a skill.md file into a Skill.
 */
export async function loadSkillFile(filePath: string): Promise<Skill> {
  const { frontMatter, body } = await parseSkillFile(filePath);
  const { data, error } = frontMatterSchema.safeParse(frontMatter);
  if (error) {
    throw new SkillParseError(
      `Skill validation failed: ${JSON.stringify(error.issues, null, 2)}`,
      filePath
    );
  }
  const relative = path.relative('', filePath);
  const segments = relative.split(path.sep);
  const skillsIdx = segments.indexOf('skills');
  const domain =
    skillsIdx >= 0 && segments.length > skillsIdx + 2
      ? segments[skillsIdx + 1]
      : path.basename(path.dirname(filePath));
  return { ...data, body, domain };
}
