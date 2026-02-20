import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DebugBackend } from '../backends/types.js';
import { EventStream } from '../events/event-stream.js';
import { SessionManager } from '../session/session-manager.js';
import { TurnManager } from '../session/turn-manager.js';

import { registerLifecycleTools } from './lifecycle.js';
import { registerControlTools } from './control.js';
import { registerBreakpointTools } from './breakpoints.js';
import { registerInspectionTools } from './inspection.js';
import { registerSourceTools } from './source.js';

/**
 * Register all 17 GlassBox MCP tools on the given server instance.
 *
 * Tools registered:
 *   Lifecycle  (3): debug/launch, debug/attach, debug/disconnect
 *   Control    (4): debug/continue, debug/step_over, debug/step_into, debug/step_out
 *   Breakpoints(2): debug/breakpoint, debug/catch
 *   Inspection (7): debug/locals, debug/inspect, debug/evaluate, debug/stacktrace,
 *                   debug/threads, debug/classes, debug/methods
 *   Source     (1): debug/source
 */
export function registerAllTools(
  server: McpServer,
  getBackend: () => DebugBackend | null,
  setBackend: (b: DebugBackend | null) => void,
  eventStream: EventStream,
  sessionManager: SessionManager,
  turnManager: TurnManager,
): void {
  // Lifecycle tools always work regardless of turn mode (meta-operations).
  registerLifecycleTools(server, getBackend, setBackend, eventStream, sessionManager);

  // All other tools are gated by TurnManager (RFC-005).
  registerControlTools(server, getBackend, eventStream, sessionManager, turnManager);
  registerBreakpointTools(server, getBackend, eventStream, sessionManager, turnManager);
  registerInspectionTools(server, getBackend, eventStream, sessionManager, turnManager);
  registerSourceTools(server, getBackend, eventStream, sessionManager, turnManager);
}
