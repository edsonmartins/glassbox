import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { DebugBackend } from '../backends/types.js';
import { EventStream } from '../events/event-stream.js';
import { SessionManager } from '../session/session-manager.js';
import { TurnManager } from '../session/turn-manager.js';

/**
 * Register inspection MCP tools: debug/locals, debug/inspect, debug/evaluate,
 * debug/stacktrace, debug/threads, debug/classes, debug/methods.
 */
export function registerInspectionTools(
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

  // ── debug/locals ────────────────────────────────────────────
  server.tool(
    'debug/locals',
    'Get local variables for the current stack frame.',
    {
      thread_id: z.string().describe('Thread to inspect'),
      frame_index: z.number().optional().describe('Stack frame index (default: 0 = top)'),
      max_depth: z.number().optional().describe('Max object nesting depth (default: 2)'),
      max_elements: z.number().optional().describe('Max array/collection elements (default: 10)'),
    },
    async (args) => {
      const startMs = Date.now();
      try {
        requireAiTurn();
        const backend = requireBackend();
        const result = await backend.getLocals(
          args.thread_id,
          args.frame_index,
          args.max_depth,
          args.max_elements,
        );

        const durationMs = Date.now() - startMs;
        const estimatedTokens = 60;
        sessionManager.recordToolCall(estimatedTokens);

        eventStream.publish('agent_action', 'ai', {
          tool: 'debug/locals',
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
          tool: 'debug/locals',
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
              error_code: 'LOCALS_FAILED',
              message,
            }),
          }],
          isError: true,
        };
      }
    },
  );

  // ── debug/inspect ───────────────────────────────────────────
  server.tool(
    'debug/inspect',
    'Deep-inspect an expression, variable, or field — returns structured object representation.',
    {
      expression: z.string().describe('Java expression to inspect (e.g. "this.cache", "user.getName()")'),
      thread_id: z.string().describe('Thread context for evaluation'),
      frame_index: z.number().optional().describe('Stack frame index (default: 0)'),
      max_depth: z.number().optional().describe('Max object nesting depth (default: 3)'),
      max_string_length: z.number().optional().describe('Truncate strings longer than this (default: 200)'),
    },
    async (args) => {
      const startMs = Date.now();
      try {
        requireAiTurn();
        const backend = requireBackend();
        const result = await backend.inspect(
          args.expression,
          args.thread_id,
          args.frame_index,
          args.max_depth,
          args.max_string_length,
        );

        const durationMs = Date.now() - startMs;
        const estimatedTokens = 80;
        sessionManager.recordToolCall(estimatedTokens);

        eventStream.publish('agent_action', 'ai', {
          tool: 'debug/inspect',
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
          tool: 'debug/inspect',
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
              error_code: 'INSPECT_FAILED',
              message,
            }),
          }],
          isError: true,
        };
      }
    },
  );

  // ── debug/evaluate ──────────────────────────────────────────
  server.tool(
    'debug/evaluate',
    'Evaluate an arbitrary Java expression in the context of a suspended thread.',
    {
      expression: z.string().describe('Java expression to evaluate'),
      thread_id: z.string().describe('Thread context for evaluation'),
      frame_index: z.number().optional().describe('Stack frame index (default: 0)'),
    },
    async (args) => {
      const startMs = Date.now();
      try {
        requireAiTurn();
        const backend = requireBackend();
        const result = await backend.evaluate(
          args.expression,
          args.thread_id,
          args.frame_index,
        );

        const durationMs = Date.now() - startMs;
        const estimatedTokens = 50;
        sessionManager.recordToolCall(estimatedTokens);

        eventStream.publish('agent_action', 'ai', {
          tool: 'debug/evaluate',
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
          tool: 'debug/evaluate',
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
              error_code: 'EVALUATE_FAILED',
              message,
            }),
          }],
          isError: true,
        };
      }
    },
  );

  // ── debug/stacktrace ────────────────────────────────────────
  server.tool(
    'debug/stacktrace',
    'Get the call stack of a suspended thread.',
    {
      thread_id: z.string().describe('Thread to get the stack trace for'),
      max_frames: z.number().optional().describe('Max frames to return (default: 20)'),
      filter_jdk: z.boolean().optional().describe('Hide java.*/javax.* frames (default: false)'),
    },
    async (args) => {
      const startMs = Date.now();
      try {
        requireAiTurn();
        const backend = requireBackend();
        const result = await backend.getStacktrace(
          args.thread_id,
          args.max_frames,
          args.filter_jdk,
        );

        const durationMs = Date.now() - startMs;
        const estimatedTokens = 50;
        sessionManager.recordToolCall(estimatedTokens);

        eventStream.publish('agent_action', 'ai', {
          tool: 'debug/stacktrace',
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
          tool: 'debug/stacktrace',
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
              error_code: 'STACKTRACE_FAILED',
              message,
            }),
          }],
          isError: true,
        };
      }
    },
  );

  // ── debug/threads ───────────────────────────────────────────
  server.tool(
    'debug/threads',
    'List all threads in the target JVM and their states.',
    {
      include_daemon: z.boolean().optional().describe('Include daemon threads (default: true)'),
      include_system: z.boolean().optional().describe('Include system threads (default: false)'),
    },
    async (args) => {
      const startMs = Date.now();
      try {
        requireAiTurn();
        const backend = requireBackend();
        const result = await backend.getThreads(
          args.include_daemon,
          args.include_system,
        );

        const durationMs = Date.now() - startMs;
        const estimatedTokens = 40;
        sessionManager.recordToolCall(estimatedTokens);

        eventStream.publish('agent_action', 'ai', {
          tool: 'debug/threads',
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
          tool: 'debug/threads',
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
              error_code: 'THREADS_FAILED',
              message,
            }),
          }],
          isError: true,
        };
      }
    },
  );

  // ── debug/classes ─────────────────────────────────────────
  server.tool(
    'debug/classes',
    'List loaded classes in the target JVM, optionally filtered by name substring.',
    {
      filter: z.string().optional().describe('Filter classes by substring (e.g. "com.example")'),
    },
    async (args) => {
      const startMs = Date.now();
      try {
        requireAiTurn();
        const backend = requireBackend();
        const classes = await backend.listClasses(args.filter);

        const durationMs = Date.now() - startMs;
        const estimatedTokens = 40;
        sessionManager.recordToolCall(estimatedTokens);

        const result = { total: classes.length, classes };

        eventStream.publish('agent_action', 'ai', {
          tool: 'debug/classes',
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
          tool: 'debug/classes',
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
              error_code: 'CLASSES_FAILED',
              message,
            }),
          }],
          isError: true,
        };
      }
    },
  );

  // ── debug/methods ─────────────────────────────────────────
  server.tool(
    'debug/methods',
    'List all methods of a loaded class in the target JVM.',
    {
      class_name: z.string().describe('Fully qualified class name (e.g. "com.example.PedidoService")'),
    },
    async (args) => {
      const startMs = Date.now();
      try {
        requireAiTurn();
        const backend = requireBackend();
        const methods = await backend.listMethods(args.class_name);

        const durationMs = Date.now() - startMs;
        const estimatedTokens = 50;
        sessionManager.recordToolCall(estimatedTokens);

        const result = { className: args.class_name, methods };

        eventStream.publish('agent_action', 'ai', {
          tool: 'debug/methods',
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
          tool: 'debug/methods',
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
              error_code: 'METHODS_FAILED',
              message,
            }),
          }],
          isError: true,
        };
      }
    },
  );
}
