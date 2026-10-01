import { randomUUID } from 'node:crypto';
import type { Environment as IEnvironment, WikiMaintainer } from '../types.js';
import { CommitLog } from './commit-log.js';
import { InMemoryWikiMaintainer } from './wiki.js';

export interface EnvironmentOptions {
  properties?: Record<string, string>;
  wiki?: WikiMaintainer;
}

/**
 * The environment the MissionManager creates and passes down to every agent:
 * properties, the WikiMaintainer instance, and the working-slate commit store.
 */
export class EnvironmentImpl implements IEnvironment {
  readonly id = randomUUID();
  readonly properties: Record<string, string>;
  readonly wiki: WikiMaintainer;
  readonly commits = new CommitLog();

  constructor(options: EnvironmentOptions = {}) {
    this.properties = { ...options.properties };
    this.wiki = options.wiki ?? new InMemoryWikiMaintainer();
  }

  describe(): string {
    const properties = Object.entries(this.properties)
      .map(([key, value]) => `- ${key}: ${value}`)
      .join('\n');
    const lessons = this.wiki
      .lessons()
      .map((entry) => `- ${entry.content}`)
      .join('\n');
    return [
      'Environment properties:',
      properties || '(none)',
      '',
      'Wiki lessons:',
      lessons || '(none yet)',
    ].join('\n');
  }
}
