import { defineDoc } from '@earendil-works/pi-durable';

/** Per-conversation parent context read by the spawn_agent tool. */
export const AgentContextDoc = defineDoc<{
  agentId: string;
  depth: number;
}>({
  kind: 'llmx.agent-context',
  version: 1,
  scope: 'conversation',
  history: 'latest',
  fork: 'current',
  initial: () => ({ agentId: 'unknown', depth: 0 }),
});
