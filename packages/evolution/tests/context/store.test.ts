import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Context } from '../../src/context/index.ts';
import { FileContextStore } from '../../src/context/store.ts';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

function directory(): string {
  const dir = mkdtempSync(join(tmpdir(), 'context-store-'));
  dirs.push(dir);
  return dir;
}

function context(overrides: Partial<Context> = {}): Context {
  return {
    id: 'tool:search',
    type: 'tool',
    name: 'Search',
    description: 'Find things',
    content: '# Search\n',
    ...overrides,
  };
}

describe('FileContextStore', () => {
  it('materializes one markdown file per context in a `contexts/` folder', () => {
    const path = directory();
    const store = new FileContextStore(
      [
        context(),
        context({
          id: 'src/pinpoint.ts',
          type: 'code',
          name: 'Pinpoint',
          description: 'Locate culprits',
          content: 'export const pinpoint = 1;\n',
        }),
      ],
      path,
    );

    expect(store.directory).toBe(join(path, 'contexts'));

    const files = readdirSync(store.directory).sort();
    expect(files).toHaveLength(2);
    expect(files.every((name) => name.endsWith('.md'))).toBe(true);

    const tool = readFileSync(
      join(
        store.directory,
        files.find((name) => name.startsWith('tool')) as string,
      ),
      'utf8',
    );
    expect(tool).toContain("id: 'tool:search'");
    expect(tool).toContain('type: tool');
    expect(tool).toContain('name: Search');
    expect(tool).toContain('# Search');
  });

  it('lists and gets every context by reference', () => {
    const path = directory();
    const search = context();
    const pinpoint = context({ id: 'src/pinpoint.ts', type: 'code' });
    const store = new FileContextStore([search, pinpoint], path);

    expect(
      store
        .list()
        .map((item) => item.id)
        .sort(),
    ).toEqual(['src/pinpoint.ts', 'tool:search']);
    expect(store.get('tool:search')).toEqual(search);
    expect(store.get('src/pinpoint.ts')).toEqual(pinpoint);
    expect(store.get('missing')).toBeUndefined();
  });

  it('returns the latest state on every read — no caching', () => {
    const path = directory();
    const store = new FileContextStore([context()], path);
    const [file] = readdirSync(store.directory);
    const target = join(store.directory, file);

    const edited = readFileSync(target, 'utf8').replace(
      '# Search',
      '# Search v2',
    );
    writeFileSync(target, edited, 'utf8');

    expect(store.get('tool:search')?.content).toContain('# Search v2');
    expect(
      store.list().find((item) => item.id === 'tool:search')?.content,
    ).toContain('# Search v2');
  });

  it('round-trips ids that are not valid filenames', () => {
    const path = directory();
    const store = new FileContextStore(
      [context({ id: 'agent:researcher' }), context({ id: 'a/b c' })],
      path,
    );

    expect(store.list()).toHaveLength(2);
    expect(store.get('agent:researcher')?.id).toBe('agent:researcher');
    expect(store.get('a/b c')?.id).toBe('a/b c');
  });

  it('re-renders into a new working directory and reads from it', async () => {
    const first = directory();
    const second = directory();
    const store = new FileContextStore([context()], first);

    await expect(store.createWorkingDirectory(second)).resolves.toBe(
      join(second, 'contexts'),
    );
    expect(store.directory).toBe(join(second, 'contexts'));
    expect(readdirSync(store.directory)).toHaveLength(1);

    const [file] = readdirSync(store.directory);
    const target = join(store.directory, file);
    writeFileSync(
      target,
      readFileSync(target, 'utf8').replace('# Search', '# Search rendered'),
      'utf8',
    );

    expect(store.get('tool:search')?.content).toContain('# Search rendered');
  });
});
