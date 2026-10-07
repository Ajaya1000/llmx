import type { ContextStore } from '../ports.ts';
import type { Context, Ref } from '../types.ts';

/** Map-backed ContextStore — the provided default (tests, in-memory clients). */
export class InMemoryContextStore implements ContextStore {
  private readonly contexts = new Map<Ref, Context>();

  constructor(initial: readonly Context[] = []) {
    for (const context of initial) this.contexts.set(context.id, context);
  }

  list(): Context[] {
    return [...this.contexts.values()];
  }

  get(id: Ref): Context | undefined {
    return this.contexts.get(id);
  }

  write(context: Context): void {
    this.contexts.set(context.id, context);
  }
}
