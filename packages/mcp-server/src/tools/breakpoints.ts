import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { DebugBackend } from '../backends/types.js';
import { EventStream } from '../events/event-stream.js';
import { SessionManager } from '../session/session-manager.js';
import { TurnManager } from '../session/turn-manager.js';

/**
 * Register breakpoint MCP tools: debug/breakpoint, debug/catch.
 */
export function registerBreakpointTools(
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

  // ── debug/breakpoint ──────────────────────────────────────────
  server.tool(
    'debug/breakpoint',
    'Set or remove a line breakpoint, optionally with a condition and hit count.',
    {
      action: z.enum(['set', 'remove']).describe('Whether to set or remove the breakpoint'),
      file: z.string().describe('Fully-qualified class name or source file (e.g. com.example.Main)'),
      line: z.number().describe('Line number'),
      condition: z.string().optional().describe('Conditional expression (only for set)'),
      hit_count: z.number().optional().describe('Break after N hits (only for set)'),
    },
    async (args) => {
      const startMs = Date.now();
      try {
        requireAiTurn();
        const backend = requireBackend();
        const result = args.action === 'set'
          ? await backend.setBreakpoint(args.file, args.line, args.condition, args.hit_count)
          : await backend.removeBreakpoint(args.file, args.line);

        const durationMs = Date.now() - startMs;
        const estimatedTokens = 30;
        sessionManager.recordToolCall(estimatedTokens);

        eventStream.publish('agent_action', 'ai', {
          tool: 'debug/breakpoint',
          request: args,
          result,
          tokensUsed: estimatedTokens,
          durationMs,
        });

        // Emit breakpoint_added event when a breakpoint is set
        if (args.action === 'set') {
          eventStream.publish('breakpoint_added', 'ai', {
            breakpointId: result.id,
            file: args.file,
            line: args.line,
          });
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const durationMs = Date.now() - startMs;
        const estimatedTokens = 15;
        sessionManager.recordToolCall(estimatedTokens);

        eventStream.publish('agent_action', 'ai', {
          tool: 'debug/breakpoint',
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
              error_code: 'BREAKPOINT_FAILED',
              message,
            }),
          }],
          isError: true,
        };
      }
    },
  );

  // ── debug/catch ─────────────────────────────────────────────
  server.tool(
    'debug/catch',
    'Set an exception breakpoint to pause when a specific exception type is thrown.',
    {
      exception_class: z.string().describe('Fully-qualified exception class (e.g. java.lang.NullPointerException)'),
      caught: z.boolean().optional().describe('Break on caught exceptions (default: true)'),
      uncaught: z.boolean().optional().describe('Break on uncaught exceptions (default: true)'),
    },
    async (args) => {
      const startMs = Date.now();
      try {
        requireAiTurn();
        const backend = requireBackend();
        const result = await backend.catchException(
          args.exception_class,
          args.caught,
          args.uncaught,
        );

        const durationMs = Date.now() - startMs;
        const estimatedTokens = 30;
        sessionManager.recordToolCall(estimatedTokens);

        eventStream.publish('agent_action', 'ai', {
          tool: 'debug/catch',
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
          tool: 'debug/catch',
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
              error_code: 'CATCH_FAILED',
              message,
            }),
          }],
          isError: true,
        };
      }
    },
  );
}
