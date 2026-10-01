import { AgentToolResult } from '@earendil-works/pi-agent-core';
import { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type, type Static } from 'typebox';
import { TaskExecutor } from '../agent/agent.js';
import { type AgentDefinition } from '../agent/agents.js';
import { type TaskExecutorFactory } from '../factory/taskExecutorFactory.js';

/** Information of the parent agent */
export interface ToolProviderContext {
    agent: AgentDefinition;
    depth: number;
}

export interface ToolProvider {
    tools(context: ToolProviderContext): Array<ToolDefinition>;
}

export interface DefaultToolProviderOptions {
    factory: TaskExecutorFactory;
}

export class DefaultToolProvider implements ToolProvider {
    private readonly factory: TaskExecutorFactory;

    constructor(options: DefaultToolProviderOptions) {
        this.factory = options.factory;
    }

    tools(context: ToolProviderContext): Array<ToolDefinition> {
        return [this.spawnAgentTool(context)];
    }

    private spawnAgentTool(
        context: ToolProviderContext
    ): ToolDefinition<typeof spawnAgentParams> {
        return {
            name: 'spawn_agent',
            label: 'Spawn agent',
            description:
                'Spawn a sub-agent for a delegated task. Pass `agent` (a definition id) when this agent has definitions ' +
                'available; the child runs under its declared procedure with `task` as input. The child runs with a fresh, ' +
                'isolated context seeded only from what you pass in `context`. Its final summary is returned as the tool result.',
            parameters: spawnAgentParams,
            promptGuidelines: [
                'Delegate whole sub-tasks with spawn_agent instead of doing everything inline.',
                'Pass `context` items sparingly — the mission goal, environment, and wiki are provided automatically.',
            ],
            execute: async (
                toolCallId: string,
                params: Static<typeof spawnAgentParams>
            ): Promise<AgentToolResult> => {

                const parentAgentDef = context.agent;

                const allowed = parentAgentDef.edges.map((e) => e.target);

                if (allowed.length > 0 && !allowed.includes(params.agent)) {
                    return this.toolError(
                        `spawn_agent refused: "${params.agent}" may only spawn ` +
                        `[${allowed.join(', ')}] (its declared edges), not "${params.agent}".`
                    );
                }

                let child: TaskExecutor;

                try {
                    child = this.factory.create({
                        task: params.task,
                        agentId: params.agent,
                        depth: context.depth + 1
                    });
                } catch (err) {
                    const e = err as Error;
                    return this.toolError(e.message);
                }

                try {
                    const result = await child.run();
                    return {
                        content: [{ type: 'text', text: result.text || '(no output)' }],
                        details: undefined,
                    };
                } catch (err) {
                    const e = err as Error;
                    return this.toolError(
                        `Agent ${child.agentId} failed: ${e.name}: ${e.message}`
                    );
                }
            },
        };
    }

    private toolError(message: string): AgentToolResult<undefined> {
        return { content: [{ type: 'text', text: message }],
                 details: undefined,
                 isError: true };
    }
}

const spawnAgentParams = Type.Object({
    agent: Type.String({
        description:
            "Id of a loaded agent definition to run (e.g. explore). Its procedure becomes the child's protocol; `task` is the caller's input. Omit for a bare agent.",
    }),
    task: Type.String({
        description:
            'Input passed to the spawned agent — the task itself when `agent` is omitted.',
    }),
    context: Type.Optional(
        Type.Array(Type.String(), {
            description:
                'Context items from THIS conversation the spawned agent starts with. Empty or omitted means a clean slate — pass only what the child actually needs.',
        })
    ),
});

// const commitStateParams = Type.Object({
//   content: Type.Record(Type.String(), Type.Unknown(), {
//     description: "Your working state as key-value facts, e.g. { repo_cloned: true, branch: \"feat/x\" }.",
//   }),
//   note: Type.Optional(Type.String({ description: "One line about what this commit represents." })),
// });
// private commitStateTool(): ToolDefinition<typeof commitStateParams> {
// return {
//   name: "commit_state",
//   label: "Commit state",
//   description: "Commit your current working state (key-value facts) to the mission. In-memory per mission.",
//   parameters: commitStateParams,
//   execute: async (
//     _toolCallId: string,
//     params: Static<typeof commitStateParams>,
//   ): Promise<AgentToolResult> => {
//     // const slate = this.environment.commits.commit(this.agentId, params.content, params.note);
//     return {
//       content: [
//         {
//           type: "text",
//           text: `Committed ${slate.committedAt}: ${JSON.stringify(slate.content)}`,
//         },
//       ],
//       details: undefined,
//     };
//   },
// };
//   }
