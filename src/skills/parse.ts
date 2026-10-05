import fs from 'node:fs/promises';
import path from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { type Static, Type } from 'typebox';
import { Check, Clone, Default, Errors } from 'typebox/value';
import type { Skill } from './schema.ts';

export class SkillParseError extends Error {
  constructor(
    message: string,
    readonly filePath: string,
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
 * types alone can't guarantee its shape — typebox is used only here.
 */
const frontMatterSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1 }),
  description: Type.String({ default: '' }),
  preState: Type.Object(
    { required: Type.Optional(Type.Record(Type.String(), Type.Unknown())) },
    { default: {} },
  ),
  postState: Type.Object(
    { sets: Type.Optional(Type.Record(Type.String(), Type.Unknown())) },
    { default: {} },
  ),
  tools: Type.Array(Type.String(), { default: [] }),
  testSuite: Type.Optional(Type.String()),
  edges: Type.Array(
    Type.Object({
      id: Type.String({ minLength: 1 }),
      target: Type.String({ minLength: 1 }),
      forwardDescription: Type.String({ default: '' }),
      backwardDescription: Type.String({ default: '' }),
      condition: Type.String({ minLength: 1 }),
    }),
    { default: [] },
  ),
  metadata: Type.Object(
    {
      created: Type.String({ default: '' }),
      stats: Type.Object(
        {
          runs: Type.Integer({ minimum: 0, default: 0 }),
          success_rate: Type.Number({ minimum: 0, maximum: 1, default: 0 }),
        },
        { default: { runs: 0, success_rate: 0 } },
      ),
    },
    { default: { created: '', stats: { runs: 0, success_rate: 0 } } },
  ),
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
  filePath = '<inline>',
): RawSkillFile {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) {
    throw new SkillParseError(
      "Missing YAML front matter: file must start with a '---' fenced block",
      filePath,
    );
  }
  const [, head, body] = match;
  let frontMatter: unknown;
  try {
    frontMatter = loadYaml(head);
  } catch (err) {
    throw new SkillParseError(
      `Invalid YAML front matter: ${err instanceof Error ? err.message : String(err)}`,
      filePath,
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
  const candidate = Default(frontMatterSchema, Clone(frontMatter));
  if (!Check(frontMatterSchema, candidate)) {
    throw new SkillParseError(
      `Skill validation failed: ${JSON.stringify(
        [...Errors(frontMatterSchema, candidate)],
        null,
        2,
      )}`,
      filePath,
    );
  }
  const data = candidate as Static<typeof frontMatterSchema>;
  const relative = path.relative('', filePath);
  const segments = relative.split(path.sep);
  const skillsIdx = segments.indexOf('skills');
  const domain =
    skillsIdx >= 0 && segments.length > skillsIdx + 2
      ? segments[skillsIdx + 1]
      : path.basename(path.dirname(filePath));
  return { ...data, body, domain };
}
