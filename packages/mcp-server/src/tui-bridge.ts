import { createServer as createNetServer, type Server, type Socket } from 'node:net';
import { unlinkSync, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import type { EventStream } from './events/event-stream.js';
import type { GlassboxEvent } from './events/types.js';
import type { TurnManager } from './session/turn-manager.js';
import type { SessionManager } from './session/session-manager.js';
import type { SessionSummary, BugRecord } from './session/types.js';
import type { DebugBackend } from './backends/types.js';

/**
 * Commands received from the TUI via Unix socket.
 */
interface TuiCommand {
  type: 'command';
  action: string;
  args?: Record<string, unknown>;
}

/**
 * TuiBridge — Unix domain socket server that bridges the MCP server
 * with the Ratatui-based TUI.
 *
 * Downstream (server → TUI): forwards all EventStream events as JSONL.
 * Upstream (TUI → server): receives command JSONL and dispatches to
 * the backend/TurnManager/EventStream.
 */
export class TuiBridge {
  private server: Server | null = null;
  private client: Socket | null = null;
  private socketPath: string;
  private eventBuffer: string[] = [];
  private inputBuffer = '';

  constructor(
    private readonly eventStream: EventStream,
    private readonly turnManager: TurnManager,
    private readonly getBackend: () => DebugBackend | null,
    private readonly sessionManager?: SessionManager,
  ) {
    this.socketPath = `/tmp/glassbox-${eventStream.getSessionId()}.sock`;
  }

  /**
   * Start the Unix domain socket server and begin buffering events.
   * Returns the socket path for the TUI to connect to.
   */
  async start(): Promise<string> {
    // Clean up stale socket file
    if (existsSync(this.socketPath)) {
      unlinkSync(this.socketPath);
    }

    // Subscribe to all events and buffer them
    this.eventStream.subscribe((event: GlassboxEvent) => {
      const jsonl = this.eventStream.toJsonl(event);
      this.eventBuffer.push(jsonl);

      // Forward to connected client in real-time
      if (this.client && !this.client.destroyed) {
        this.send(this.client, jsonl);
      }
    });

    return new Promise((resolve, reject) => {
      this.server = createNetServer((socket: Socket) => {
        this.handleClient(socket);
      });

      this.server.on('error', (err) => {
        reject(err);
      });

      this.server.listen(this.socketPath, () => {
        resolve(this.socketPath);
      });
    });
  }

  /**
   * Stop the bridge and clean up the socket file.
   */
  stop(): void {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    if (existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Get the socket path (for external consumers).
   */
  getSocketPath(): string {
    return this.socketPath;
  }

  /**
   * Handle a new TUI client connection.
   * Only one client at a time — new connections replace the old one.
   */
  private handleClient(socket: Socket): void {
    // Disconnect previous client
    if (this.client && !this.client.destroyed) {
      this.client.destroy();
    }
    this.client = socket;
    this.inputBuffer = '';

    // Replay buffered events so the TUI catches up
    for (const line of this.eventBuffer) {
      this.send(socket, line);
    }

    // Read incoming commands from TUI
    socket.on('data', (data: Buffer) => {
      this.inputBuffer += data.toString();

      // Process complete lines
      let newlineIdx: number;
      while ((newlineIdx = this.inputBuffer.indexOf('\n')) !== -1) {
        const line = this.inputBuffer.slice(0, newlineIdx).trim();
        this.inputBuffer = this.inputBuffer.slice(newlineIdx + 1);

        if (line.length === 0) continue;

        try {
          const cmd = JSON.parse(line) as TuiCommand;
          if (cmd.type === 'command') {
            // Record user activity for inactivity timeout (RFC-005)
            this.turnManager.recordUserActivity();

            this.handleCommand(cmd).catch((err) => {
              this.eventStream.publish('error', 'system', {
                code: 'COMMAND_FAILED',
                message: err instanceof Error ? err.message : String(err),
              });
            });
          }
        } catch {
          // Ignore malformed commands
        }
      }
    });

    socket.on('close', () => {
      if (this.client === socket) {
        this.client = null;
      }
    });

    socket.on('error', () => {
      if (this.client === socket) {
        this.client = null;
      }
    });
  }

  /**
   * Dispatch a TUI command to the appropriate handler.
   */
  private async handleCommand(cmd: TuiCommand): Promise<void> {
    const backend = this.getBackend();
    const args = cmd.args ?? {};
    const threadId = (args.threadId as string) ?? 'main';

    switch (cmd.action) {
      case 'continue': {
        if (!backend?.isConnected()) break;
        await backend.continue(threadId);
        break;
      }
      case 'step_over': {
        if (!backend?.isConnected()) break;
        await backend.stepOver(threadId);
        break;
      }
      case 'step_into': {
        if (!backend?.isConnected()) break;
        await backend.stepInto(threadId);
        break;
      }
      case 'step_out': {
        if (!backend?.isConnected()) break;
        await backend.stepOut(threadId);
        break;
      }
      case 'toggle_control': {
        const to = (args.to as string) ?? 'manual';
        const reason = (args.reason as string) ?? 'TUI toggle';
        const mode = to === 'manual' ? 'manual'
          : to === 'autonomous' ? 'autonomous'
          : 'collaborative';
        this.turnManager.transfer(mode, reason);
        break;
      }
      case 'apply_fix': {
        const bugId = (args.bugId as string) ?? '';
        this.eventStream.publish('fix_applied', 'user', {
          bugId,
          applied: true,
        });
        break;
      }
      case 'discard_fix': {
        const bugId = (args.bugId as string) ?? '';
        this.eventStream.publish('fix_applied', 'user', {
          bugId,
          applied: false,
        });
        break;
      }
      case 'evaluate': {
        if (!backend?.isConnected()) break;
        const expression = (args.expression as string) ?? '';
        if (!expression) break;
        try {
          const result = await backend.evaluate(expression, threadId);
          this.eventStream.publish('agent_action', 'user', {
            tool: 'debug/evaluate',
            request: { expression, threadId },
            result,
            tokensUsed: 0,
            durationMs: 0,
          });
        } catch (err) {
          this.eventStream.publish('error', 'system', {
            code: 'EVAL_FAILED',
            message: err instanceof Error ? err.message : String(err),
          });
        }
        break;
      }
      case 'save_report': {
        if (!this.sessionManager) break;
        const summary = this.sessionManager.getSummary();
        const format = (args.format as string) ?? 'json';
        const sessionId = summary.sessionId || 'unknown';
        const ext = format === 'md' ? 'md' : 'json';
        const filePath = (args.path as string) ?? `glassbox-report-${sessionId}.${ext}`;

        const content = format === 'md'
          ? formatReportMarkdown(summary)
          : JSON.stringify(summary, null, 2);

        await writeFile(filePath, content, 'utf-8');

        this.eventStream.publish('agent_thinking', 'ai', {
          thought: `Session report saved to ${filePath}`,
        });
        break;
      }
      default:
        // Unknown command — ignore
        break;
    }
  }

  /**
   * Send a JSONL line to a socket.
   */
  private send(socket: Socket, data: string): void {
    try {
      socket.write(data + '\n');
    } catch {
      // Ignore write errors (client may have disconnected)
    }
  }
}

/**
 * Format a SessionSummary as Markdown for the report file.
 */
function formatReportMarkdown(summary: SessionSummary): string {
  const lines: string[] = [];
  lines.push('# GlassBox Debug Session Report');
  lines.push('');
  lines.push(`**Session ID:** ${summary.sessionId}`);
  lines.push(`**Started:** ${summary.startedAt}`);
  if (summary.endedAt) {
    lines.push(`**Ended:** ${summary.endedAt}`);
  }
  const durationSec = (summary.durationMs / 1000).toFixed(1);
  lines.push(`**Duration:** ${durationSec}s`);
  lines.push('');
  lines.push('## Statistics');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Tool calls | ${summary.stats.toolCalls} |`);
  lines.push(`| Tokens used | ${summary.stats.tokensUsed} |`);
  lines.push(`| Estimated cost | $${summary.stats.estimatedCostUsd.toFixed(4)} |`);
  lines.push(`| Total events | ${summary.stats.eventsTotal} |`);
  lines.push(`| Bugs found | ${summary.stats.bugsFound} |`);

  if (summary.comparison) {
    lines.push('');
    lines.push('## Comparison vs. Traditional Debugging');
    lines.push('');
    lines.push(`| Metric | Traditional (est.) | GlassBox | Savings |`);
    lines.push(`|--------|-------------------|----------|---------|`);
    lines.push(`| Tokens | ~${summary.comparison.traditionalEstimatedTokens} | ${summary.stats.tokensUsed} | ${summary.comparison.tokenSavingsPct}% |`);
    lines.push(`| Time | ~${summary.comparison.traditionalEstimatedTimeMin} min | ${durationSec}s | ${summary.comparison.timeSavingsPct}% |`);
  }

  if (summary.bugs.length > 0) {
    lines.push('');
    lines.push('## Bugs Found');
    lines.push('');
    for (const bug of summary.bugs) {
      lines.push(`### ${bug.id}: ${bug.title}`);
      lines.push(`- **Severity:** ${bug.severity}`);
      lines.push(`- **Location:** ${bug.location}`);
      lines.push(`- **Root Cause:** ${bug.rootCause}`);
      if (bug.fix) {
        lines.push(`- **Fix:** ${bug.fix.type} in ${bug.fix.file} (${bug.fix.status})`);
      }
      lines.push('');
    }
  }

  lines.push('');
  lines.push('---');
  lines.push('*Generated by GlassBox Debug Platform*');
  lines.push('');

  return lines.join('\n');
}
