import {
  ProcessTerminal,
  Text,
  type TUI,
  TuiMainScreen,
} from '@earendil-works/pi-tui';
import type { MissionUi } from '../types.ts';

/**
 *
 * Headless-safe positional status line using pi's TUI (differential
 * renderer, main screen). Shows the currently running agent, recent tool
 * activity, and finished-agent confirmations.
 */
export class TuiMissionUi implements MissionUi {
  private readonly terminal = new ProcessTerminal();
  private readonly main: TUI;
  private readonly status = new Text('idle');
  private readonly activity = new Text('no agent running');
  private readonly done: string[] = [];

  constructor() {
    const mainScreen = new TuiMainScreen(this.terminal);
    this.main = mainScreen;
    this.main.addChild(this.status);
    this.main.addChild(this.activity);
  }

  start(): void {
    this.main.start();
    this.main.requestRender(true);
  }

  agentStarted(agentId: string, task: string): void {
    this.status.setText(`▶ ${agentId} — ${task}`);
    this.activity.setText('…');
    this.main.requestRender();
  }

  agentEvent(
    agentId: string,
    event: { type: string; toolName?: string; delta?: string },
  ): void {
    switch (event.type) {
      case 'tool_execution_start':
        this.activity.setText(`${agentId} · ${event.toolName ?? 'tool'} …`);
        break;
      case 'tool_execution_end':
        this.activity.setText(`${agentId} · ${event.toolName ?? 'tool'} done`);
        break;
      default:
        break;
    }
    this.main.requestRender();
  }

  agentFinished(agentId: string, text: string): void {
    this.done.push(`✓ ${agentId} — ${oneLine(text, 60)}`);
    this.status.setText('idle');
    this.activity.setText(this.done[this.done.length - 1] ?? 'waiting');
    this.main.requestRender();
  }

  dispose(): void {
    this.main.stop();
  }
}

function oneLine(text: string, max = 80): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}
