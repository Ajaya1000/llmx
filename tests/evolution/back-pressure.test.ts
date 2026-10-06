import { describe, expect, it } from 'vitest';
import { DefaultBackPressure } from '../../src/evolution/back-pressure.ts';

describe('DefaultBackPressure', () => {
  it('one push yields one authored row with both refs', () => {
    const row = new DefaultBackPressure().push('task-1', 'task-2', {
      kind: 'human',
    });

    expect(row.kind).toBe('back_pressure');
    expect(row.refs.blamedRef).toBe('task-1');
    expect(row.refs.correctionRef).toBe('task-2');
    expect(row.author).toEqual({ kind: 'human' });
  });
});
