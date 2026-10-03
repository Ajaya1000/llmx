import fs from 'node:fs/promises';
import path from 'node:path';
import type { Skill } from './schema.js';
import { SkillParseError } from './parse.js';
import { compilePredicate, compilePreState } from './predicates.js';

export interface ValidationIssue {
  skillId: string;
  filePath?: string;
  message: string;
}

export class SkillValidationError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super(
      `Skill validation failed:\n${issues
        .map((i) => `- [${i.skillId}] ${i.message}`)
        .join('\n')}`,
    );
  }
}

const MAX_PARSABLE = 1024;

/**
 * Validate one loaded skill: predicate compilation and edge sanity.
 * Yaml is never executed — conditions compile only through the safe evaluator.
 */
export function validateSkill(
  skill: Skill,
  filePath?: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (message: string) =>
    issues.push({ skillId: skill.id, filePath, message });

  try {
    compilePreState(skill.preState.required);
  } catch (err) {
    add(`preState: ${err instanceof Error ? err.message : String(err)}`);
  }

  for (const edge of skill.edges ?? []) {
    try {
      compilePredicate(edge.condition);
    } catch (err) {
      add(
        `edge '${edge.id}': invalid condition — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (edge.id === edge.target) {
      add(`edge '${edge.id}': edge target cannot be its own id`);
    }
  }

  if (skill.edges?.length) {
    const seen = new Set<string>();
    for (const edge of skill.edges) {
      if (seen.has(edge.id)) {
        add(`duplicate edge id '${edge.id}'`);
      }
      seen.add(edge.id);
    }
  }

  return issues;
}

/**
 * Load every skill under <root>/<domain>/<slug>/skill.md and validate the
 * graph: local schema/predicate checks plus cross-skill dangling-edge checks.
 * Throws SkillValidationError if any skill is invalid or edges dangle.
 */
export async function loadSkillGraph(root = 'skills'): Promise<{
  skills: Skill[];
  raw: Record<string, Skill & { filePath: string }>;
}> {
  const validSkills: Skill[] = [];
  const raw: Record<string, Skill & { filePath: string }> = {};
  const issues: ValidationIssue[] = [];

  let domains: string[];
  try {
    domains = await fs
      .readdir(root, { withFileTypes: true })
      .then((d) => d.filter((e) => e.isDirectory()).map((e) => e.name));
  } catch {
    throw new SkillParseError(
      `Skill root directory not found or unreadable: ${root}`,
      root,
    );
  }

  for (const domain of domains) {
    const domainDir = path.join(root, domain);
    const slugs = await fs
      .readdir(domainDir, { withFileTypes: true })
      .then((d) => d.filter((e) => e.isDirectory()).map((e) => e.name));
    for (const slug of slugs.slice(0, MAX_PARSABLE)) {
      const filePath = path.join(domainDir, slug, 'skill.md');
      let skill: Skill;
      try {
        const mod = await import('./parse.js');
        skill = await mod.loadSkillFile(filePath);
      } catch (err) {
        issues.push({
          skillId: `${domain}/${slug}`,
          filePath,
          message:
            err instanceof SkillParseError
              ? err.message
              : err instanceof Error
                ? err.message
                : String(err),
        });
        continue;
      }
      /* domain from the directory wins id-consistency checks */
      const fileIssues = validateSkill(skill, filePath);
      issues.push(...fileIssues);
      if (fileIssues.length === 0) {
        validSkills.push(skill);
      }
      raw[skill.id] = { ...skill, filePath };
    }
  }

  /* cross-skill: dangling edge targets */
  for (const skill of validSkills) {
    for (const edge of skill.edges ?? []) {
      if (!(edge.target in raw)) {
        issues.push({
          skillId: skill.id,
          message: `edge '${edge.id}' targets missing skill '${edge.target}' (dangling edge)`,
        });
      }
    }
  }

  if (issues.length > 0) {
    throw new SkillValidationError(issues);
  }

  return { skills: validSkills, raw };
}

/**
 * Lightweight store facade. Loads the graph once; exposes by-id lookup and
 * the id → edges map used downstream by the Executor (ADR-0003 handoff).
 */
export class SkillGraphStore {
  private byId = new Map<string, Skill & { filePath: string }>();

  static async build(root = 'skills'): Promise<SkillsBuildResult> {
    const { skills, raw } = await loadSkillGraph(root);
    const store = new SkillGraphStore();
    store.byId = new Map(Object.entries(raw));
    return { store, skills };
  }

  get(id: string): (Skill & { filePath: string }) | undefined {
    return this.byId.get(id);
  }

  all(): Skill[] {
    return [...this.byId.values()];
  }

  edgesFor(id: string) {
    return this.byId.get(id)?.edges ?? [];
  }

  get size(): number {
    return this.byId.size;
  }
}

export interface SkillsBuildResult {
  store: SkillGraphStore;
  skills: Skill[];
}
