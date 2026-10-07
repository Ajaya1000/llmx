import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  type Credential,
  InMemoryCredentialStore,
  type Models,
} from '@earendil-works/pi-ai';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';

/**
 * Builtin pi-ai models with credentials seeded from pi's auth.json
 * (~/.pi/agent/auth.json). Without this, every builtin provider is
 * unauthenticated: getAvailable() is empty and requests fail with
 * "Provider is not configured" even for models the user has logged into.
 */
export async function createBuiltinModels(): Promise<Models> {
  const credentials = new InMemoryCredentialStore();
  await Promise.all(
    Object.entries(readAuthJson()).map(([providerId, credential]) =>
      credentials.modify(providerId, async () => credential),
    ),
  );
  return builtinModels({ credentials });
}

function readAuthJson(): Record<string, Credential> {
  const agentDir =
    process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent');
  try {
    return JSON.parse(readFileSync(join(agentDir, 'auth.json'), 'utf-8'));
  } catch {
    return {}; // no pi auth on this machine — providers stay ambient/env-only
  }
}
