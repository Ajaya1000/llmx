import type { Model, Models } from '@earendil-works/pi-ai';

/** Resolves the model to run agents with: LLMX_MODEL=provider/modelId env var, or the first static chat model. */
export function resolveAgentModel(models: Models): Model<string> {
  const configured = process.env.LLMX_MODEL;
  if (configured) {
    const [provider, modelId] = configured.split('/', 2);
    const model =
      provider && modelId ? models.getModel(provider, modelId) : undefined;
    if (!model) {
      throw new Error(
        `LLMX_MODEL="${configured}" does not match any known model. ` +
          'Configure the provider/model in pi settings or pick a listed one.',
      );
    }
    return model;
  }
  const first = models.getModels()[0];
  if (!first) {
    throw new Error(
      'No model is configured. Set OPENAI_API_KEY / pi settings, or LLMX_MODEL=provider/modelId.',
    );
  }
  return first;
}
