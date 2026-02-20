import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { DebugBackend } from '../backends/types.js';
import { EventStream } from '../events/event-stream.js';
import { SessionManager } from '../session/session-manager.js';
import { TurnManager } from '../session/turn-manager.js';

/**
 * Register source MCP tools: debug/source.
 */
export function registerSourceTools(
  server: McpServer,
  getBackend: () => DebugBackend | null,
  eventStream: EventStream,
  sessionManager: SessionManager,
  turnManager: TurnManager,
): void {
  function requireBackend(): DebugBackend {
    const backend = getBackend();
    if (!backend) {
      throw new Error('No active debug session.');
    }
    return backend;
  }

  function requireAiTurn(): void {
    if (!turnManager.canAiAct()) {
      throw new Error(
        `AI action blocked: current mode is '${turnManager.getMode()}'. ` +
        'Transfer control to AI before executing debug actions.',
      );
    }
  }

  // ── debug/source ────────────────────────────────────────────
  server.tool(
    'debug/source',
    'Retrieve source code around a specific line, with current-line and breakpoint markers.',
    {
      file: z.string().describe('Source file path or fully-qualified class name'),
      line: z.number().describe('Center line number'),
      context_lines: z.number().optional().describe('Lines of context above/below (default: 10)'),
    },
    async (args) => {
      const startMs = Date.now();
      try {
        requireAiTurn();
        const backend = requireBackend();
        const result = await backend.getSource(
          args.file,
          args.line,
          args.context_lines,
        );

        const durationMs = Date.now() - startMs;
        const estimatedTokens = 50;
        sessionManager.recordToolCall(estimatedTokens);

        eventStream.publish('agent_action', 'ai', {
          tool: 'debug/source',
          request: args,
          result,
          tokensUsed: estimatedTokens,
          durationMs,
        });

        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const durationMs = Date.now() - startMs;
        const estimatedTokens = 15;
        sessionManager.recordToolCall(estimatedTokens);

        eventStream.publish('agent_action', 'ai', {
          tool: 'debug/source',
          request: args,
          result: { status: 'error', message },
          tokensUsed: estimatedTokens,
          durationMs,
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'error',
              error_code: 'SOURCE_FAILED',
              message,
            }),
          }],
          isError: true,
        };
      }
    },
  );
}
