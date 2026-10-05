import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels, type Models } from '@earendil-works/pi-ai';
import { createRegistry, Harness } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';

/** Context passed to every pi-durable call. */
export const ctx = BACKGROUND_CONTEXT;

export interface DurableHarnessConfig {
  /** SQLite file path. Default: ./data/durable.sqlite */
  storagePath?: string;
  /** Model collection override, e.g. a fake provider in tests. */
  models?: Models;
  /** Installs extra extensions after the built-ins (tests). */
  installExtensions?: (registry: ReturnType<typeof createRegistry>) => void;
}

let openPromise: Promise<Harness> | undefined;

/**
 * The process-wide harness. A storage is owned by exactly one process — every
 * session (root agent, spawned children) runs on this single Harness.
 */
export function getDurableHarness(
  config: DurableHarnessConfig = {},
): Promise<Harness> {
  openPromise ??= (async () => {
    const registry = createRegistry();
    config.installExtensions?.(registry);
    const models = config.models ?? createModels();
    const storagePath = config.storagePath ?? 'data/durable.sqlite';
    const storage = await openNodeSqliteStorage(storagePath);
    return Harness.open(storage, { models, registry }, ctx);
  })();
  return openPromise;
}

/** Closes the singleton harness (awaited by graceful shutdown). */
export async function closeDurableHarness(): Promise<void> {
  const pending = openPromise;
  openPromise = undefined;
  await (await pending)?.close(ctx);
}
