import type OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import { modelFromOpenAI } from '../../src/model/completion.ts';

/** Minimal stub shaped like the SDK client (only `create` is exercised). */
function stubClient(content: string | null): OpenAI {
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content } }],
        }),
      },
    },
  } as unknown as OpenAI;
}

describe('modelFromOpenAI', () => {
  it('sends the prompt as one user message and returns the text', async () => {
    const seen: OpenAI.ChatCompletionMessageParam[] = [];
    const client = {
      chat: {
        completions: {
          create: async (args: { messages: typeof seen }) => {
            seen.push(...args.messages);
            return { choices: [{ message: { content: 'hi' } }] };
          },
        },
      },
    } as unknown as OpenAI;

    const model = modelFromOpenAI(client, 'gpt-4o-mini');
    await expect(model?.complete('hello')).resolves.toBe('hi');
    expect(seen).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('falls back to empty string when the SDK returns null content', async () => {
    const model = modelFromOpenAI(stubClient(null), 'gpt-4o-mini');
    await expect(model?.complete('hello')).resolves.toBe('');
  });

  it('returns undefined without a client', () => {
    expect(modelFromOpenAI(undefined, 'gpt-4o-mini')).toBeUndefined();
  });

  it('throws without a model name', () => {
    expect(() => modelFromOpenAI(stubClient('hi'), undefined)).toThrow(
      /openaiModel/,
    );
  });
});
