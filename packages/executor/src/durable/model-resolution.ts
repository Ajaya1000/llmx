import type { Model, Models } from '@earendil-works/pi-ai';

/**
 * Resolves the model to run agents with. LLMX_MODEL=provider/modelId wins when
 * that model's provider is authenticated; otherwise (unset, unknown id, or
 * unauthenticated provider) the first available authenticated chat model is
 * picked automatically. Only fails when no authenticated model exists at all.
 */
export async function resolveAgentModel(
  models: Models,
): Promise<Model<string>> {
  const configured = process.env.LLMX_MODEL;
  if (configured) {
    const [provider, modelId] = configured.split('/', 2);
    const model =
      provider && modelId
        ? (await models.getAvailable(provider)).find((m) => m.id === modelId)
        : undefined;
    if (model) return model;
    console.warn(
      `[llmx] LLMX_MODEL="${configured}" is not available (unknown or not authenticated); auto-picking instead.`,
    );
  }
  const first = (await models.getAvailable())[0];
  if (!first) {
    throw new Error(
      'No authenticated model found. Log a provider into pi (auth.json), ' +
        'set its API key env var, or set LLMX_MODEL=provider/modelId.',
    );
  }
  return first;
}
