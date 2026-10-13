import {
  type AgentDefinition,
  type MissionManagerOptions,
  MissionUIType,
} from '@llmx/executor';
import { describe, expect, it } from 'vitest';
import {
  MissionAgenticExecutor,
  type MissionRunnerFactory,
} from '../../src/agent/index.js';

// The default runner (MissionManager) needs a live model, so tests inject a
// fake; only its shape and the wiring are asserted here.

describe('MissionAgenticExecutor', () => {
  it('runs one mission with the profile handed directly and the system prompt as procedure', async () => {
    const captured: MissionManagerOptions[] = [];
    const runner: MissionRunnerFactory = (options) => {
      captured.push(options);
      return {
        run: async () => ({
          goal: 'distill run',
          result: {
            agentId: 'trajectory-distiller',
            text: 'distilled.',
            transcript: [],
            trajectory: {
              flow: '',
              definition: [],
              traces: [],
              sourceRecords: [],
            },
          },
          trajectory: {
            flow: '',
            definition: [],
            traces: [],
            sourceRecords: [],
          },
        }),
      };
    };

    const outcome = await new MissionAgenticExecutor(
      {
        id: 'trajectory-distiller',
        title: 'Trajectory Distiller',
        description: 'Distills trajectories.',
        goal: 'distill run',
        subagentDefs: [],
      },
      runner,
    ).run({
      systemPrompt: 'distill step by step',
      task: 'read the store',
      cwd: '/somewhere',
    });

    expect(outcome).toEqual({ summary: 'distilled.' });
    expect(captured).toHaveLength(1);
    const options = captured[0];
    if (!options) throw new Error('mission manager never received options');
    expect(options.uiType).toBe(MissionUIType.LOG);
    expect(options.cwd).toBe('/somewhere');
    expect(options.mission.goal).toBe('distill run');
    expect(options.mission.entry.task).toBe('read the store');
    expect(typeof options.mission.entry.agent).toBe('object');
    const entry = options.mission.entry.agent as AgentDefinition;
    expect(entry).toMatchObject({
      id: 'trajectory-distiller',
      title: 'Trajectory Distiller',
      description: 'Distills trajectories.',
      body: 'distill step by step',
    });
    expect(options.agentDefs).toEqual([]);
  });
});
