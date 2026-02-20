import { describe, it, expect, afterEach, vi } from 'vitest';
import { createConnection, type Socket } from 'node:net';
import { existsSync, unlinkSync, readFileSync } from 'node:fs';
import { EventStream } from '../src/events/event-stream.js';
import { TurnManager } from '../src/session/turn-manager.js';
import { SessionManager } from '../src/session/session-manager.js';
import { TuiBridge } from '../src/tui-bridge.js';
import type { DebugBackend, StopEvent, SourceLocation } from '../src/backends/types.js';

// ── Helpers ──

function createMockBackend(): DebugBackend {
  const location: SourceLocation = { file: 'Test.java', line: 10, class: 'Test', method: 'main' };
  const stopEvent: StopEvent = { status: 'stopped', reason: 'step_completed', location, thread: 'main' };

  return {
    launch: vi.fn(),
    attach: vi.fn(),
    disconnect: vi.fn(),
    continue: vi.fn().mockResolvedValue(stopEvent),
    stepOver: vi.fn().mockResolvedValue(stopEvent),
    stepInto: vi.fn().mockResolvedValue(stopEvent),
    stepOut: vi.fn().mockResolvedValue(stopEvent),
    setBreakpoint: vi.fn(),
    removeBreakpoint: vi.fn(),
    catchException: vi.fn(),
    getLocals: vi.fn(),
    inspect: vi.fn(),
    evaluate: vi.fn(),
    getStacktrace: vi.fn(),
    getThreads: vi.fn(),
    getSource: vi.fn(),
    listClasses: vi.fn().mockResolvedValue([]),
    listMethods: vi.fn().mockResolvedValue([]),
    isConnected: vi.fn().mockReturnValue(true),
    on: vi.fn(),
  } as unknown as DebugBackend;
}

function connectToSocket(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const client = createConnection(path, () => resolve(client));
    client.on('error', reject);
  });
}

function readLines(socket: Socket, count: number, timeoutMs = 2000): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    let buffer = '';
    const timeout = setTimeout(() => {
      resolve(lines); // Return what we have
    }, timeoutMs);

    socket.on('data', (data) => {
      buffer += data.toString();
      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        lines.push(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
        if (lines.length >= count) {
          clearTimeout(timeout);
          resolve(lines);
          return;
        }
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function sendCommand(socket: Socket, action: string, args?: Record<string, unknown>): void {
  const cmd = JSON.stringify({ type: 'command', action, args: args ?? {} });
  socket.write(cmd + '\n');
}

// ── Tests ──

describe('TuiBridge', () => {
  let bridge: TuiBridge;
  let eventStream: EventStream;
  let turnManager: TurnManager;
  let sessionManager: SessionManager;
  let backend: DebugBackend;

  afterEach(() => {
    if (bridge) {
      bridge.stop();
    }
  });

  async function createBridge(): Promise<string> {
    eventStream = new EventStream();
    turnManager = new TurnManager(eventStream);
    sessionManager = new SessionManager(eventStream);
    backend = createMockBackend();
    bridge = new TuiBridge(eventStream, turnManager, () => backend, sessionManager);
    return bridge.start();
  }

  it('creates socket file on start', async () => {
    const path = await createBridge();
    expect(existsSync(path)).toBe(true);
  });

  it('removes socket file on stop', async () => {
    const path = await createBridge();
    expect(existsSync(path)).toBe(true);
    bridge.stop();
    expect(existsSync(path)).toBe(false);
  });

  it('accepts a TUI client connection', async () => {
    const path = await createBridge();
    const client = await connectToSocket(path);
    expect(client).toBeDefined();
    client.destroy();
  });

  it('replays buffered events to new client', async () => {
    const path = await createBridge();

    // Emit events before client connects
    eventStream.publish('agent_thinking', 'ai', { thought: 'test1' });
    eventStream.publish('agent_thinking', 'ai', { thought: 'test2' });

    // Small delay to ensure events are buffered
    await new Promise((r) => setTimeout(r, 20));

    // Connect client
    const client = await connectToSocket(path);
    const lines = await readLines(client, 2);

    expect(lines).toHaveLength(2);
    const ev1 = JSON.parse(lines[0]);
    const ev2 = JSON.parse(lines[1]);
    expect(ev1.type).toBe('agent_thinking');
    expect(ev1.data.thought).toBe('test1');
    expect(ev2.data.thought).toBe('test2');

    client.destroy();
  });

  it('forwards live events to connected client', async () => {
    const path = await createBridge();
    const client = await connectToSocket(path);

    // Small delay to ensure connection is established
    await new Promise((r) => setTimeout(r, 20));

    // Emit event after client connected
    eventStream.publish('agent_thinking', 'ai', { thought: 'live-event' });

    const lines = await readLines(client, 1);
    expect(lines).toHaveLength(1);
    const ev = JSON.parse(lines[0]);
    expect(ev.type).toBe('agent_thinking');
    expect(ev.data.thought).toBe('live-event');

    client.destroy();
  });

  it('dispatches continue command to backend', async () => {
    const path = await createBridge();
    const client = await connectToSocket(path);
    await new Promise((r) => setTimeout(r, 20));

    sendCommand(client, 'continue', { threadId: 'main' });
    await new Promise((r) => setTimeout(r, 50));

    expect(backend.continue).toHaveBeenCalledWith('main');
    client.destroy();
  });

  it('dispatches step_over command to backend', async () => {
    const path = await createBridge();
    const client = await connectToSocket(path);
    await new Promise((r) => setTimeout(r, 20));

    sendCommand(client, 'step_over', { threadId: 'main' });
    await new Promise((r) => setTimeout(r, 50));

    expect(backend.stepOver).toHaveBeenCalledWith('main');
    client.destroy();
  });

  it('dispatches toggle_control to TurnManager', async () => {
    const path = await createBridge();
    const client = await connectToSocket(path);
    await new Promise((r) => setTimeout(r, 20));

    expect(turnManager.getMode()).toBe('autonomous');
    sendCommand(client, 'toggle_control', { to: 'manual', reason: 'TUI toggle' });
    await new Promise((r) => setTimeout(r, 50));

    expect(turnManager.getMode()).toBe('manual');
    client.destroy();
  });

  it('dispatches apply_fix via eventStream', async () => {
    const path = await createBridge();

    // Collect events
    const events: unknown[] = [];
    eventStream.subscribe((ev) => events.push(ev));

    const client = await connectToSocket(path);
    await new Promise((r) => setTimeout(r, 20));

    sendCommand(client, 'apply_fix', { bugId: 'NPE-001' });
    await new Promise((r) => setTimeout(r, 50));

    const fixEvent = events.find((e: any) => e.type === 'fix_applied') as any;
    expect(fixEvent).toBeDefined();
    expect(fixEvent.data.bugId).toBe('NPE-001');
    expect(fixEvent.data.applied).toBe(true);

    client.destroy();
  });

  it('handles client disconnect gracefully', async () => {
    const path = await createBridge();
    const client = await connectToSocket(path);
    await new Promise((r) => setTimeout(r, 20));

    client.destroy();
    await new Promise((r) => setTimeout(r, 50));

    // Bridge should still be operational — emitting events should not throw
    expect(() => {
      eventStream.publish('agent_thinking', 'ai', { thought: 'after disconnect' });
    }).not.toThrow();
  });

  it('replaces old client when new one connects', async () => {
    const path = await createBridge();

    // Emit an event before any client
    eventStream.publish('agent_thinking', 'ai', { thought: 'before' });
    await new Promise((r) => setTimeout(r, 20));

    // First client connects
    const client1 = await connectToSocket(path);
    const lines1 = await readLines(client1, 1);
    expect(lines1).toHaveLength(1);

    // Second client connects (replaces first)
    const client2 = await connectToSocket(path);
    const lines2 = await readLines(client2, 1);
    expect(lines2).toHaveLength(1); // Gets the buffered event

    client1.destroy();
    client2.destroy();
  });

  it('dispatches save_report and writes JSON file', async () => {
    const path = await createBridge();
    sessionManager.start();
    sessionManager.recordToolCall(42);

    const client = await connectToSocket(path);
    await new Promise((r) => setTimeout(r, 20));

    // Use a temp file path for the report
    const reportPath = `/tmp/glassbox-test-report-${Date.now()}.json`;
    sendCommand(client, 'save_report', { path: reportPath, format: 'json' });
    await new Promise((r) => setTimeout(r, 100));

    expect(existsSync(reportPath)).toBe(true);
    const content = readFileSync(reportPath, 'utf-8');
    const report = JSON.parse(content);
    expect(report.stats.toolCalls).toBe(1);
    expect(report.stats.tokensUsed).toBe(42);

    // Cleanup
    try { unlinkSync(reportPath); } catch { /* ignore */ }
    client.destroy();
  });

  it('dispatches save_report and writes Markdown file', async () => {
    const path = await createBridge();
    sessionManager.start();

    const client = await connectToSocket(path);
    await new Promise((r) => setTimeout(r, 20));

    const reportPath = `/tmp/glassbox-test-report-${Date.now()}.md`;
    sendCommand(client, 'save_report', { path: reportPath, format: 'md' });
    await new Promise((r) => setTimeout(r, 100));

    expect(existsSync(reportPath)).toBe(true);
    const content = readFileSync(reportPath, 'utf-8');
    expect(content).toContain('# GlassBox Debug Session Report');
    expect(content).toContain('Tool calls');

    // Cleanup
    try { unlinkSync(reportPath); } catch { /* ignore */ }
    client.destroy();
  });
});
