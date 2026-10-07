import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { createModels, type Models } from '@earendil-works/pi-ai/models';

export interface FakeModelsOptions {
  /** Scripted responses; exhausted script reapplies the last response. */
  responses?: Parameters<ReturnType<typeof fauxProvider>['setResponses']>;
}

/** Builds a Models collection with the pi-ai faux provider ("faux/faux-model") for tests. */
export function createFakeModels(options: FakeModelsOptions = {}): Models {
  const faux = fauxProvider({
    // Some hosts report fake models in dynamic overlays; keep static listing pure.
    // The provider id is "faux" with a "faux-model" model out of the box.
  });
  const models = createModels();
  models.setProvider(faux.provider);
  if (options.responses) {
    faux.setResponses(options.responses);
  } else {
    // The script is consumed per model call; provide an ample repetition.
    faux.setResponses(
      Array.from({ length: 128 }, () => fauxAssistantMessage('echo')),
    );
  }
  return models;
}

/** The faux provider/model ref used in tests. */
export const FAUX_MODEL = { provider: 'faux', modelId: 'faux-1' };
