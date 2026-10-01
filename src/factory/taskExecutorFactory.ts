import { TaskExecutor } from '../agent/agent.js';
import { type AgentDefinition } from '../agent/agents.js';
import { AgentSessionRepository } from '../repository/agent-session.js';
import { ToolProvider } from '../tools/toolProvider.js';
import type { MissionUi } from '../types.js';

export interface TaskExecutorCreateContext {
    task: string;
    agentId: string;
    depth: number;
    toolProvider?: ToolProvider;
}

export interface TaskExecutorFactory {
    create(context: TaskExecutorCreateContext): TaskExecutor;
}

export interface DefaultTaskExecutorFactoryOptions {
    ui: MissionUi;
    cwd?: string;
    agentDefs: AgentDefinition[];
    repository: AgentSessionRepository;
    maxSpawnDepth: number;
}

export class DefaultTaskExecutorFactory implements TaskExecutorFactory {
    private readonly agentDefs: AgentDefinition[];
    private readonly maxSpawnDepth: number;
    private readonly repository: AgentSessionRepository;
    private readonly cwd?: string;
    private readonly ui: MissionUi;

    constructor(options: DefaultTaskExecutorFactoryOptions) {
        this.agentDefs = options.agentDefs;
        this.maxSpawnDepth = options.maxSpawnDepth;
        this.repository = options.repository;
        this.cwd = options.cwd;
        this.ui = options.ui;
    }

    create(context: TaskExecutorCreateContext): TaskExecutor {
        if (context.depth >= this.maxSpawnDepth) {
            throw new Error(
                `spawn_agent refused: nesting depth limit (${this.maxSpawnDepth}) reached. Complete the task yourself.`
            );
        }

        const definition = this.agentDefs.find((d) => d.id === context.agentId);

        if (!definition) {
            const available =
                this.agentDefs.map((d) => d.id).join(', ') || 'none';
            throw new Error(`Unknown agent id "${context.agentId}". Available definitions: ${available}.`);
        }

        const child = new TaskExecutor({
            agentId: context.agentId,
            task: context.task,
            definition,
            depth: context.depth,
            cwd: this.cwd,
            repository: this.repository,
            ui: this.ui,
            toolProvider: context.toolProvider
        });

        return child;
    }
}
