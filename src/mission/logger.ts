import type { MissionUi } from '../types.js';

/**
 * Plain terminal logging implementation of MissionUi. Prints lifecycle
 * and session events as normal lines (no TUI, no cursor control).
 */
export class LogMissionUi implements MissionUi {
  start(): void {}

  agentStarted(agentId: string, task: string): void {
    console.log(`[mission] ▶ ${agentId} — ${task}`);
  }

  agentFinished(agentId: string, text: string): void {
    console.log(`[mission] ✓ ${agentId} — ${oneLine(text, 200)}`);
  }

  agentEvent(
    agentId: string,
    event: { type: string; toolName?: string; delta?: string }
  ): void {
    switch (event.type) {
      case 'tool_execution_start':
        console.log(`[mission] · ${agentId} → ${event.toolName ?? 'tool'} …`);
        break;
      case 'tool_execution_end':
        console.log(`[mission] · ${agentId} → ${event.toolName ?? 'tool'} done`);
        break;
      default:
        break;
    }
  }

  dispose(): void {}
}

function oneLine(text: string, max = 80): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}
