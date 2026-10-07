import { afterEach, describe, expect, it } from 'vitest';
import { resolveAgentModel } from '../../src/durable/model-resolution.ts';
import { createFakeModels } from '../helpers/fake-models.ts';

describe('resolveAgentModel', () => {
  afterEach(() => {
    delete process.env.LLMX_MODEL;
  });

  it('auto-picks an available model when LLMX_MODEL is unset', async () => {
    const model = await resolveAgentModel(createFakeModels());
    expect(model.provider).toBe('faux');
    expect(model.id).toBe('faux-1');
  });

  it('uses LLMX_MODEL when that model is available', async () => {
    process.env.LLMX_MODEL = 'faux/faux-1';
    const model = await resolveAgentModel(createFakeModels());
    expect(`${model.provider}/${model.id}`).toBe('faux/faux-1');
  });

  it('falls back to auto-pick when LLMX_MODEL is not available', async () => {
    process.env.LLMX_MODEL = 'nope/unknown-model';
    const model = await resolveAgentModel(createFakeModels());
    expect(`${model.provider}/${model.id}`).toBe('faux/faux-1');
  });

  it('throws when no authenticated model exists', async () => {
    const none = { getAvailable: async () => [] };
    await expect(resolveAgentModel(none as never)).rejects.toThrow(
      /No authenticated model/,
    );
  });
});
