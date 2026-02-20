import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { DebugBackend, LaunchConfig, AttachConfig, StopEvent } from '../backends/types.js';
import { JdbBackend } from '../backends/jdb/jdb-backend.js';
import { EventStream } from '../events/event-stream.js';
import { SessionManager } from '../session/session-manager.js';

/**
 * Wire backend EventEmitter events to the EventStream.
 *
 * JdbBackend emits 'stopped', 'output', and 'disconnected' events.
 * This function bridges them to the structured GlassBox EventStream
 * so the TUI, JSONL log, and external consumers all see them.
 */
function wireBackendEvents(
  backend: DebugBackend,
  eventStream: EventStream,
): void {
  backend.on('stopped', (stopEvent: StopEvent) => {
    if (stopEvent.reason === 'breakpoint_hit') {
      eventStream.publish('breakpoint_hit', 'debugger', {
        breakpointId: '',
        location: stopEvent.location,
        thread: stopEvent.thread,
      });
    } else if (stopEvent.reason === 'exception_caught') {
      eventStream.publish('exception_caught', 'debugger', {
        exceptionType: stopEvent.exception?.type ?? '',
        message: stopEvent.exception?.message ?? null,
        location: stopEvent.location,
        thread: stopEvent.thread,
        isCaught: true,
      });
    } else if (stopEvent.reason === 'step_completed') {
      eventStream.publish('step_completed', 'debugger', {
        stepType: 'over',
        location: stopEvent.location,
        thread: stopEvent.thread,
      });
    }
  });

  backend.on('output', (text: string, stream: 'stdout' | 'stderr') => {
    eventStream.publish(
      stream === 'stdout' ? 'app_stdout' : 'app_stderr',
      'system',
      { text, truncated: false },
    );
  });
}

/**
 * Register lifecycle MCP tools: debug/launch, debug/attach, debug/disconnect.
 */
export function registerLifecycleTools(
  server: McpServer,
  getBackend: () => DebugBackend | null,
  setBackend: (b: DebugBackend | null) => void,
  eventStream: EventStream,
  sessionManager: SessionManager,
): void {
  // ── debug/launch ──────────────────────────────────────────────
  server.tool(
    'debug/launch',
    'Compile and launch a Java project with JDWP debug agent, then connect JDB.',
    {
      project_dir: z.string().describe('Root directory of the project'),
      build_tool: z.enum(['maven', 'gradle', 'manual']).describe('Build tool to use'),
      main_class: z.string().optional().describe('Main class (auto-detected if omitted)'),
      jvm_args: z.array(z.string()).optional().describe('Additional JVM arguments'),
      app_args: z.array(z.string()).optional().describe('Application arguments'),
      port: z.number().optional().describe('JDWP port (default: 5005)'),
      suspend: z.boolean().optional().describe('Suspend until attach (default: true)'),
    },
    async (args) => {
      const startMs = Date.now();
      try {
        const config: LaunchConfig = {
          projectDir: args.project_dir,
          buildTool: args.build_tool,
          mainClass: args.main_class,
          jvmArgs: args.jvm_args,
          appArgs: args.app_args,
          port: args.port,
          suspend: args.suspend,
        };

        const backend = new JdbBackend();
        const result = await backend.launch(config);
        setBackend(backend);
        wireBackendEvents(backend, eventStream);

        sessionManager.start();

        // Emit app_started and session_started per RFC-003/006
        eventStream.publish('app_started', 'system', {
          pid: result.pid,
          mainClass: result.mainClass,
        });

        eventStream.publish('session_started', 'debugger', {
          pid: result.pid,
          jdkVersion: result.jdkVersion,
          mainClass: result.mainClass,
          jdwpPort: result.jdwpPort,
        });

        const durationMs = Date.now() - startMs;
        const estimatedTokens = 50;
        sessionManager.recordToolCall(estimatedTokens);

        eventStream.publish('agent_action', 'ai', {
          tool: 'debug/launch',
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
        const estimatedTokens = 20;
        sessionManager.recordToolCall(estimatedTokens);

        eventStream.publish('agent_action', 'ai', {
          tool: 'debug/launch',
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
              error_code: 'LAUNCH_FAILED',
              message,
            }),
          }],
          isError: true,
        };
      }
    },
  );

  // ── debug/attach ──────────────────────────────────────────────
  server.tool(
    'debug/attach',
    'Attach to a running Java process with JDWP enabled.',
    {
      host: z.string().optional().describe('Hostname (default: localhost)'),
      port: z.number().describe('JDWP port'),
    },
    async (args) => {
      const startMs = Date.now();
      try {
        const config: AttachConfig = {
          host: args.host,
          port: args.port,
        };

        const backend = new JdbBackend();
        const result = await backend.attach(config);
        setBackend(backend);
        wireBackendEvents(backend, eventStream);

        sessionManager.start();

        // Emit session_started per RFC-003/006
        // PID is 0 for attach — JDB CLI limitation (see detectRemotePid())
        eventStream.publish('session_started', 'debugger', {
          pid: result.pid,
          jdkVersion: result.jdkVersion,
          mainClass: 'unknown',
          jdwpPort: args.port,
        });

        const durationMs = Date.now() - startMs;
        const estimatedTokens = 30;
        sessionManager.recordToolCall(estimatedTokens);

        eventStream.publish('agent_action', 'ai', {
          tool: 'debug/attach',
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
          tool: 'debug/attach',
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
              error_code: 'ATTACH_FAILED',
              message,
            }),
          }],
          isError: true,
        };
      }
    },
  );

  // ── debug/disconnect ──────────────────────────────────────────
  server.tool(
    'debug/disconnect',
    'End the debug session and optionally terminate the target process.',
    {
      terminate: z.boolean().optional().describe('Kill the target process (default: false)'),
    },
    async (args) => {
      const startMs = Date.now();
      try {
        const backend = getBackend();
        if (!backend) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'error',
                error_code: 'NOT_CONNECTED',
                message: 'No active debug session.',
              }),
            }],
            isError: true,
          };
        }

        const result = await backend.disconnect(args.terminate);
        setBackend(null);

        const durationMs = Date.now() - startMs;
        const estimatedTokens = 20;
        sessionManager.recordToolCall(estimatedTokens);

        // Use sessionManager for accurate totalTokens (backend always returns 0)
        const summary = sessionManager.complete();
        const enrichedResult = {
          ...result,
          totalTokens: summary.stats.tokensUsed,
        };

        eventStream.publish('agent_action', 'ai', {
          tool: 'debug/disconnect',
          request: args,
          result: enrichedResult,
          tokensUsed: estimatedTokens,
          durationMs,
        });

        return {
          content: [{ type: 'text', text: JSON.stringify(enrichedResult) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const durationMs = Date.now() - startMs;
        const estimatedTokens = 10;
        sessionManager.recordToolCall(estimatedTokens);

        eventStream.publish('agent_action', 'ai', {
          tool: 'debug/disconnect',
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
              error_code: 'DISCONNECT_FAILED',
              message,
            }),
          }],
          isError: true,
        };
      }
    },
  );
}
