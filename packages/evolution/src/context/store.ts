import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import type { Context, ContextStore, ContextType, Ref } from './index.js';

const CONTEXT_TYPES: readonly ContextType[] = [
  'tool',
  'skill',
  'agent',
  'code',
];

/**
 * File-backed {@link ContextStore}: materializes each context as one markdown
 * file in a store-owned folder. Every read re-reads the folder, so a file
 * edited a moment ago is reflected immediately.
 */
export class FileContextStore implements ContextStore {
  private readonly path: string;

  constructor(contexts: readonly Context[], path: string) {
    this.path = join(path, 'contexts');
    mkdirSync(this.path, { recursive: true });
    for (const context of contexts) this.materialize(context);
  }

  /** The store-owned `contexts/` folder holding one markdown file per context. */
  get directory(): string {
    return this.path;
  }

  list(): Context[] {
    return readdirSync(this.path)
      .filter((name) => name.endsWith('.md'))
      .sort()
      .map((name) => parseContext(readFileSync(join(this.path, name), 'utf8')));
  }

  get(id: Ref): Context | undefined {
    return this.list().find((context) => context.id === id);
  }

  private materialize(context: Context): void {
    const text = matter.stringify(context.content, {
      id: context.id,
      type: context.type,
      name: context.name,
      description: context.description,
    });
    writeFileSync(join(this.path, fileName(context.id)), text, 'utf8');
  }
}

/** Injective filename: distinct ids can never collide on disk. */
function fileName(id: Ref): string {
  return `${encodeURIComponent(id)}.md`;
}

function parseContext(text: string): Context {
  const { data, content } = matter(text);
  const { id, type } = data;
  if (typeof id !== 'string' || !id) {
    throw new Error('context file is missing its `id`');
  }
  if (!isContextType(type)) {
    throw new Error(`context "${id}" has unknown type "${String(type ?? '')}"`);
  }
  return {
    id,
    type,
    name: stringField(data.name),
    description: stringField(data.description),
    content,
  };
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isContextType(value: unknown): value is ContextType {
  return (
    typeof value === 'string' &&
    (CONTEXT_TYPES as readonly string[]).includes(value)
  );
}
