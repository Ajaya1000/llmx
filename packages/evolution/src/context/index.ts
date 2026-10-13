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
 * Always-fresh, read-only view over the context artifacts. `createWorkingDirectory`
 * renders a file copy for a coding agent to read; it never mutates the artifacts.
 */
export interface ContextStore {
  /** Every context — the complete artifact set. */
  list(): Context[];
  /** One context by reference. */
  get(id: Ref): Context | undefined;
  /**
   * Materializes every context as a file under `<path>/contexts`, so a coding
   * agent can read them; returns the created `contexts/` folder.
   */
  createWorkingDirectory(path: string): Promise<string>;
}

export { FileContextStore } from './store.js';
