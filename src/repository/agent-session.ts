import {
  createAgentSession,
  SessionManager,
  type AgentSession,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';

export interface CreateSessionParams {
  /** Working directory for project-local discovery. Default: process.cwd() */
  cwd?: string;
  /** pi custom tools registered on the session (in addition to the built-in tools). */
  customTools?: ToolDefinition[];
  /** Allowlist of built-in tool names. */
  tools?: string[];
  /** Denylist of built-in tool names to disable. */
  excludeTools?: string[];
}

/**
 * Session repository backed by pi-coding-agent. Every call creates a fresh
 * in-memory AgentSession — one per agent — so sessions never share a parent's
 * history by accident. Model selection, auth, streaming, retries, and tool
 * dispatch are owned by pi (ambient pi settings and credentials).
 */
export class AgentSessionRepository {
  async createSession(params: CreateSessionParams = {}): Promise<AgentSession> {
    const { session } = await createAgentSession({
      sessionManager: SessionManager.inMemory(),
      ...(params.cwd ? { cwd: params.cwd } : {}),
      ...(params.customTools?.length
        ? { customTools: params.customTools }
        : {}),
      ...(params.tools ? { tools: params.tools } : {}),
      ...(params.excludeTools ? { excludeTools: params.excludeTools } : {}),
    });
    return session;
  }
}
