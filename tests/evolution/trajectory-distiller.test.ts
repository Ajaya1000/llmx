import { describe, expect, it } from 'vitest';
import { InMemoryTrajectoryStore } from '../../src/evolution/store/trajectory.ts';
import {
  DefaultTrajectoryDistiller,
  type DistilledEntry,
  type Judger,
  type Run,
} from '../../src/evolution/trajectory-distiller.ts';
import type { TaskEvent } from '../../src/evolution/types.ts';

function task(partial: Partial<TaskEvent> & { id: string }): TaskEvent {
  return {
    kind: 'agent_run',
    producer: 'agent-a',
    contextsUsed: [],
    contextEdges: [],
    inputRefs: [],
    outputRefs: [],
    status: 'done',
    ...partial,
  };
}

describe('DefaultTrajectoryDistiller', () => {
  it('collects judger rows into the distilled log', () => {
    const store = new InMemoryTrajectoryStore();
    store.onTask(task({ id: 'run1' }));

    const judger: Judger = {
      distill: (): DistilledEntry[] => [
        { kind: 'strategy', polarity: 'positive', content: 'do X' },
      ],
    };
    const log = new DefaultTrajectoryDistiller(judger).distill(store);

    expect(log.rows).toHaveLength(1);
    expect(log.rows[0].kind).toBe('strategy');
    expect(log.rows[0].refs.taskId).toBe('run1');
  });

  it('assembles a run with subtree tasks and transcript records', () => {
    const store = new InMemoryTrajectoryStore();
    store.onTask(task({ id: 'run1' }));
    store.onTask(task({ id: 'tool1', parentId: 'run1', kind: 'tool_call' }));
    store.record({
      id: 'r1',
      taskId: 'tool1',
      role: 'tool_result',
      content: 'x',
    });
    store.record({ id: 'r2', taskId: 'run1', role: 'assistant', content: 'y' });

    let captured: Run | undefined;
    const judger: Judger = {
      distill: (run) => {
        captured = run;
        return [];
      },
    };
    new DefaultTrajectoryDistiller(judger).distill(store);

    expect(captured?.root.id).toBe('run1');
    expect(captured?.tasks.map((t) => t.id)).toEqual(['tool1']);
    expect(captured?.records.map((r) => r.id).sort()).toEqual(['r1', 'r2']);
  });
});
