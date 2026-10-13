import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DefinitionItem, Trace, Trajectory } from './index.js';

/** Filesystem representation of a trajectory as a `trajectory/` folder. */
export class TrajectoryStore {
  readonly trajectory: Trajectory;
  readonly location: string;

  constructor(trajectory: Trajectory, location: string) {
    this.trajectory = trajectory;
    this.location = location;
  }

  /** Folder containing the serialized trajectory. */
  get directory(): string {
    return join(this.location, 'trajectory');
  }

  /** Creates the working directory: `trajectory/flow.md`, `definition.json`, `traces.json`. */
  async createWorkingDirectory(): Promise<string> {
    await mkdir(this.directory, { recursive: true });
    await Promise.all([
      writeFile(join(this.directory, 'flow.md'), this.trajectory.flow, 'utf8'),
      writeFile(
        join(this.directory, 'definition.json'),
        `${JSON.stringify(this.trajectory.definition, null, 2)}\n`,
        'utf8',
      ),
      writeFile(
        join(this.directory, 'traces.json'),
        `${JSON.stringify(this.trajectory.traces, null, 2)}\n`,
        'utf8',
      ),
    ]);
    return this.directory;
  }

  /** Loads a trajectory previously written by {@link TrajectoryStore.createWorkingDirectory}. */
  static async read(location: string): Promise<TrajectoryStore> {
    const dir = join(location, 'trajectory');
    const [flow, definition, traces] = await Promise.all([
      readFile(join(dir, 'flow.md'), 'utf8'),
      readFile(join(dir, 'definition.json'), 'utf8'),
      readFile(join(dir, 'traces.json'), 'utf8'),
    ]);
    const trajectory: Trajectory = {
      flow,
      definition: JSON.parse(definition) as DefinitionItem[],
      traces: JSON.parse(traces) as Trace[],
    };
    return new TrajectoryStore(trajectory, location);
  }
}
