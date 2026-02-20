import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { DebugBackend } from '../backends/types.js';
import { EventStream } from '../events/event-stream.js';
import { SessionManager } from '../session/session-manager.js';
import { TurnManager } from '../session/turn-manager.js';

/**
 * Register execution control MCP tools: debug/continue, debug/step_over,
 * debug/step_into, debug/step_out.
 */
export function registerControlTools(
  server: McpServer,
  getBackend: () => DebugBackend | null,
  eventStream: EventStream,
  sessionManager: SessionManager,
  turnManager: TurnManager,
): void {
  /** Helper: ensure a backend is connected before executing a control action. */
  function requireBackend(): DebugBackend {
    const backend = getBackend();
    if (!backend) {
      throw new Error('No active debug session.');
    }
    return backend;
  }

  /** Ensure AI is allowed to act in the current turn mode (RFC-005). */
  function requireAiTurn(): void {
    if (!turnManager.canAiAct()) {
      throw new Error(
        `AI action blocked: current mode is '${turnManager.getMode()}'. ` +
        'Transfer control to AI before executing debug actions.',
      );
    }
  }

  // ── debug/continue ────────────────────────────────────────────
  server.tool(
    'debug/continue',
    'Resume execution until the next breakpoint, exception, or program exit.',
    {
      thread_id: z.string().optional().describe('Thread to resume (all threads if omitted)'),
    },
    async (args) => {
      const startMs = Date.now();
      try {
        requireAiTurn();
        const backend = requireBackend();
        const result = await backend.continue(args.thread_id);
        const durationMs = Date.now() - startMs;
        const estimatedTokens = 40;
        sessionManager.recordToolCall(estimatedTokens);

        eventStream.publish('agent_action', 'ai', {
          tool: 'debug/continue',
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
          tool: 'debug/continue',
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
              error_code: 'CONTINUE_FAILED',
              message,
            }),
          }],
          isError: true,
        };
      }
    },
  );

  // ── debug/step_over ───────────────────────────────────────────
  server.tool(
    'debug/step_over',
    'Execute the current line and stop at the next line (without entering method calls).',
    {
      thread_id: z.string().describe('Thread to step'),
    },
    async (args) => {
      const startMs = Date.now();
      try {
        requireAiTurn();
        const backend = requireBackend();
        const result = await backend.stepOver(args.thread_id);
        const durationMs = Date.now() - startMs;
        const estimatedTokens = 40;
        sessionManager.recordToolCall(estimatedTokens);

        eventStream.publish('agent_action', 'ai', {
          tool: 'debug/step_over',
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
          tool: 'debug/step_over',
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
              error_code: 'STEP_OVER_FAILED',
              message,
            }),
          }],
          isError: true,
        };
      }
    },
  );

  // ── debug/step_into ───────────────────────────────────────────
  server.tool(
    'debug/step_into',
    'Step into the method call on the current line.',
    {
      thread_id: z.string().describe('Thread to step'),
      filter_jdk: z.boolean().optional().describe('Skip java.* classes (default: true)'),
    },
    async (args) => {
      const startMs = Date.now();
      try {
        requireAiTurn();
        const backend = requireBackend();
        const result = await backend.stepInto(args.thread_id, args.filter_jdk);
        const durationMs = Date.now() - startMs;
        const estimatedTokens = 40;
        sessionManager.recordToolCall(estimatedTokens);

        eventStream.publish('agent_action', 'ai', {
          tool: 'debug/step_into',
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
          tool: 'debug/step_into',
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
              error_code: 'STEP_INTO_FAILED',
              message,
            }),
          }],
          isError: true,
        };
      }
    },
  );

  // ── debug/step_out ────────────────────────────────────────────
  server.tool(
    'debug/step_out',
    'Step out of the current method and stop at the caller.',
    {
      thread_id: z.string().describe('Thread to step out of'),
    },
    async (args) => {
      const startMs = Date.now();
      try {
        requireAiTurn();
        const backend = requireBackend();
        const result = await backend.stepOut(args.thread_id);
        const durationMs = Date.now() - startMs;
        const estimatedTokens = 40;
        sessionManager.recordToolCall(estimatedTokens);

        eventStream.publish('agent_action', 'ai', {
          tool: 'debug/step_out',
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
          tool: 'debug/step_out',
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
              error_code: 'STEP_OUT_FAILED',
              message,
            }),
          }],
          isError: true,
        };
      }
    },
  );
}
