export interface PredicateSpec {
  required?: Record<string, unknown>;
}

export interface SkillEdge {
  id: string;
  target: string;
  forwardDescription: string;
  backwardDescription: string;
  condition: string;
}

export interface SkillStats {
  runs: number;
  success_rate: number;
}

export interface SkillMetadata {
  created: string;
  stats: SkillStats;
}

export interface SkillFrontMatter {
  id: string;
  title: string;
  description: string;
  preState: PredicateSpec;
  postState: { sets?: Record<string, unknown> };
  tools: string[];
  testSuite?: string;
  edges: SkillEdge[];
  metadata: SkillMetadata;
}

/** A fully loaded skill: validated front matter + the Markdown procedural body */
export interface Skill extends SkillFrontMatter {
  body: string;
  domain: string;
}
