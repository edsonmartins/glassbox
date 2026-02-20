import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DebugBackend } from './backends/types.js';
import { EventStream } from './events/event-stream.js';
import { SessionManager } from './session/session-manager.js';
import { TurnManager } from './session/turn-manager.js';
import { TuiBridge } from './tui-bridge.js';
import { registerAllTools } from './tools/index.js';

/**
 * Create and configure the GlassBox MCP Server with all 17 debug tools.
 */
export function createServer(): {
  server: McpServer;
  eventStream: EventStream;
  sessionManager: SessionManager;
  turnManager: TurnManager;
  tuiBridge: TuiBridge;
} {
  const server = new McpServer({
    name: 'glassbox',
    version: '0.1.0',
  });

  const eventStream = new EventStream();
  const sessionManager = new SessionManager(eventStream);
  const turnManager = new TurnManager(eventStream);

  // Mutable backend reference — set when debug/launch or debug/attach is called.
  let backend: DebugBackend | null = null;

  const getBackend = (): DebugBackend | null => backend;
  const setBackend = (b: DebugBackend | null): void => {
    backend = b;
  };

  // Wire JSONL output to stderr so MCP stdout stays clean.
  eventStream.subscribe((event) => {
    process.stderr.write(eventStream.toJsonl(event) + '\n');
  });

  // Register all 17 MCP tools.
  registerAllTools(server, getBackend, setBackend, eventStream, sessionManager, turnManager);

  // Create TUI bridge (start separately via bridge.start() when needed).
  const tuiBridge = new TuiBridge(eventStream, turnManager, getBackend, sessionManager);

  return { server, eventStream, sessionManager, turnManager, tuiBridge };
}
