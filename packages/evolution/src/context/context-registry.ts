import type { Context, Ref } from '../types.ts';

/** Runtime usage edge: context `from` used context `to` (from depends on to). */
export interface UsageEdge {
  from: Ref;
  to: Ref;
}

/**
 * The context dependency graph — every improvable artifact (tool / skill /
 * agent) and which contexts depend on which. Built from each context's static
 * `dependsOn` plus the runtime usage edges observed from task records.
 */
export interface ContextRegistry {
  get(id: Ref): Context | undefined;
  /** Transitive dependents of `id` — contexts that (transitively) depend on it. */
  dependents(id: Ref): Ref[];
  /** The connected component(s) around `ids` — ids plus their dependencies and dependents. */
  subgraph(ids: Ref[]): Context[];
  all(): Context[];
}

/** In-memory context graph over `Context.dependsOn` + observed usage edges. */
export class InMemoryContextRegistry implements ContextRegistry {
  private contexts = new Map<Ref, Context>();
  /** from → to ("from depends on to"). */
  private edges = new Map<Ref, Set<Ref>>();
  /** reverse: to → froms. */
  private reverse = new Map<Ref, Set<Ref>>();

  /** Register a context and its static `dependsOn` edges. */
  register(context: Context): void {
    this.contexts.set(context.id, context);
    for (const dep of context.dependsOn) this.addEdge(context.id, dep);
  }

  /** Record runtime usage edges (e.g. an agent run using a tool). */
  observe(edges: readonly UsageEdge[]): void {
    for (const edge of edges) this.addEdge(edge.from, edge.to);
  }

  get(id: Ref): Context | undefined {
    return this.contexts.get(id);
  }

  dependents(id: Ref): Ref[] {
    const seen = new Set<Ref>([id]);
    const queue: Ref[] = [id];
    const out: Ref[] = [];
    for (let i = 0; i < queue.length; i++) {
      for (const dependent of this.reverse.get(queue[i]) ?? []) {
        if (!seen.has(dependent)) {
          seen.add(dependent);
          out.push(dependent);
          queue.push(dependent);
        }
      }
    }
    return out;
  }

  subgraph(ids: Ref[]): Context[] {
    const reachable = new Set<Ref>();
    const walk = (start: Ref, forward: boolean): void => {
      const seen = new Set<Ref>([start]);
      const queue: Ref[] = [start];
      for (let i = 0; i < queue.length; i++) {
        const neighbors = forward
          ? this.edges.get(queue[i])
          : this.reverse.get(queue[i]);
        for (const next of neighbors ?? []) {
          if (!seen.has(next)) {
            seen.add(next);
            reachable.add(next);
            queue.push(next);
          }
        }
      }
    };
    for (const id of ids) {
      reachable.add(id);
      walk(id, true); // dependencies
      walk(id, false); // dependents
    }
    const out: Context[] = [];
    for (const id of reachable) {
      const context = this.contexts.get(id);
      if (context) out.push(context);
    }
    return out;
  }

  all(): Context[] {
    return [...this.contexts.values()];
  }

  private addEdge(from: Ref, to: Ref): void {
    let deps = this.edges.get(from);
    if (!deps) {
      deps = new Set();
      this.edges.set(from, deps);
    }
    deps.add(to);
    let rev = this.reverse.get(to);
    if (!rev) {
      rev = new Set();
      this.reverse.set(to, rev);
    }
    rev.add(from);
  }
}
