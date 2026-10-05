// Spike: verify @earendil-works/pi-durable + openNodeSqliteStorage round-trip.
// Run: node scripts/spike-durable.ts
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import {
  createRegistry,
  defineDoc,
  Harness,
  type Storage,
} from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';

const ctx = BACKGROUND_CONTEXT;
const dbPath = 'data/spike-durable.sqlite';

const probe = defineDoc<{ visits: number; notes: string[] }>({
  kind: 'spike.probe',
  version: 1,
  scope: 'conversation',
  history: 'latest',
  fork: 'current',
  initial: () => ({ visits: 0, notes: [] }),
});

async function open(): Promise<{ storage: Storage; harness: Harness }> {
  const storage = await openNodeSqliteStorage(dbPath);
  const harness = await Harness.open(
    storage,
    { models: createModels(), registry: createRegistry() },
    ctx,
  );
  return { storage, harness };
}

async function main() {
  // Run 1: create root conversation, commit doc state, close.
  {
    const { harness } = await open();
    const root = await harness.root(ctx);
    await root.commit(async (tx) => {
      (await tx.doc(probe, root.id)).notes.push('hello-from-run-1');
    }, ctx);
    await harness.close(ctx);
    console.log('run1: committed note to root', root.id);
  }

  // Run 2: reopen, verify persistence, commit again, close.
  {
    const { harness } = await open();
    const root = await harness.root(ctx);
    const snapshot = await harness.snapshot(probe, root.id, ctx);
    console.log('run2: root id persisted:', root.id);
    console.log('run2: doc snapshot:', JSON.stringify(snapshot));
    if (!snapshot.notes.includes('hello-from-run-1')) {
      throw new Error('FAIL: doc state did not persist');
    }
    await root.commit(async (tx) => {
      (await tx.doc(probe, root.id)).visits += 1;
    }, ctx);
    const after = await harness.snapshot(probe, root.id, ctx);
    console.log('run2: after increment:', JSON.stringify(after));
    await harness.close(ctx);
  }

  console.log('SPIKE OK');
}

main().catch((err) => {
  console.error('SPIKE FAILED:', err);
  process.exit(1);
});
