/** Opaque reference to a context artifact. */
export type Ref = string;

/** Everything that can be improved or added to the AI. */
export type ContextType = 'tool' | 'skill' | 'agent' | 'code';

/** A context artifact: its identity, one-line summary, and body. */
export interface Context {
  id: Ref;
  type: ContextType;
  name: string;
  description: string;
  content: string;
}

/**
 * Read-only, always-fresh view over the context artifacts. There is no write
 * method: mutation happens by editing the markdown files directly.
 */
export interface ContextStore {
  /** Every context — the complete artifact set. */
  list(): Context[];
  /** One context by reference. */
  get(id: Ref): Context | undefined;
}

export { FileContextStore } from './store.js';
