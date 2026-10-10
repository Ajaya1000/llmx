import type OpenAI from 'openai';
import type { ModelCall } from '../ports.ts';

/** Adapts an OpenAI client to the framework's raw `ModelCall`. */
export function modelFromOpenAI(
  client: OpenAI | undefined,
  model: string | undefined,
): ModelCall | undefined {
  if (!client) return undefined;
  if (!model)
    throw new Error(
      'Evolution `openai` needs `openaiModel` (the chat model name).',
    );
  return {
    complete: async (prompt: string) => {
      const completion = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
      });
      return completion.choices[0]?.message?.content ?? '';
    },
  };
}
