import { EventEmitter } from 'node:events';
import { JdbProcess } from './jdb-process.js';
import { parseAsyncEvent } from './jdb-parser.js';

/** Default timeout for a single JDB command (ms). */
const DEFAULT_TIMEOUT_MS = 5_000;

/** Regex that matches the JDB prompt at the start of a line. */
const PROMPT_RE = /^> /m;

interface QueueEntry {
  command: string;
  resolve: (output: string) => void;
  reject: (error: Error) => void;
  timeoutMs: number;
}

/**
 * Sequential command queue for JDB.
 *
 * JDB only processes one command at a time. This class queues commands,
 * sends them one-by-one, collects output until the next `>` prompt (or
 * timeout), and separates asynchronous events from command responses.
 *
 * Emits:
 * - 'async_event' ({ type: string; data: Record<string, unknown> })
 *   for breakpoint hits, exceptions, thread events, VM events, etc.
 */
export class JdbCommandQueue extends EventEmitter {
  private queue: QueueEntry[] = [];
  private processing = false;
  private buffer = '';
  private dataHandler: ((chunk: string) => void) | null = null;

  constructor(private readonly jdb: JdbProcess) {
    super();
  }

  /**
   * Queue a JDB command for execution. Returns the command output
   * (with async events stripped out) once JDB produces the next prompt.
   *
   * @param command   - The JDB command string (e.g. "locals", "where", "cont")
   * @param timeoutMs - Maximum time to wait for the prompt (default 5 000 ms)
   */
  execute(command: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.queue.push({ command, resolve, reject, timeoutMs });
      this.processNext();
    });
  }

  // ── Internal ────────────────────────────────────────────────────

  private processNext(): void {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    const entry = this.queue.shift()!;
    this.buffer = '';

    // Set up a listener for stdout data
    this.dataHandler = (chunk: string) => {
      this.buffer += chunk;
    };
    this.jdb.on('data', this.dataHandler);

    // Write the command
    try {
      this.jdb.write(entry.command);
    } catch (err) {
      this.cleanup();
      entry.reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    // Wait for prompt or timeout
    const timer = setTimeout(() => {
      this.finish(entry, true);
    }, entry.timeoutMs);

    // Poll for prompt (checking each new chunk is simpler than partial-match streaming)
    const checkPrompt = (chunk: string) => {
      // Re-check full buffer after each chunk
      if (PROMPT_RE.test(this.buffer) || this.buffer.trimEnd().endsWith('>')) {
        clearTimeout(timer);
        // Remove this extra listener
        this.jdb.removeListener('data', checkPrompt);
        this.finish(entry, false);
      }
    };
    this.jdb.on('data', checkPrompt);

    // Also handle process exit while waiting
    const onExit = () => {
      clearTimeout(timer);
      this.jdb.removeListener('data', checkPrompt);
      this.finish(entry, false);
    };
    this.jdb.once('exit', onExit);

    // Store references so finish() can clean up
    (entry as any)._checkPrompt = checkPrompt;
    (entry as any)._onExit = onExit;
    (entry as any)._timer = timer;
  }

  /**
   * Finalize a command: separate events from response, emit events,
   * resolve the promise, then move to the next command.
   */
  private finish(entry: QueueEntry, timedOut: boolean): void {
    // Clean up listeners
    if ((entry as any)._checkPrompt) {
      this.jdb.removeListener('data', (entry as any)._checkPrompt);
    }
    if ((entry as any)._onExit) {
      this.jdb.removeListener('exit', (entry as any)._onExit);
    }
    this.cleanup();

    const rawOutput = this.buffer;
    this.buffer = '';

    // Separate async events from command response
    const { response, events } = this.separateEvents(rawOutput);

    // Emit each async event
    for (const ev of events) {
      this.emit('async_event', ev);
    }

    // Resolve (even on timeout, we return whatever we collected)
    if (timedOut && response.trim() === '') {
      entry.reject(new Error(`JDB command timed out after ${entry.timeoutMs}ms: "${entry.command}"`));
    } else {
      entry.resolve(response);
    }

    this.processing = false;
    this.processNext();
  }

  /**
   * Remove the data handler from the process.
   */
  private cleanup(): void {
    if (this.dataHandler) {
      this.jdb.removeListener('data', this.dataHandler);
      this.dataHandler = null;
    }
  }

  /**
   * Split raw JDB output into:
   * - response: the lines that are the command's direct response
   * - events: async event objects parsed from interleaved event lines
   */
  private separateEvents(raw: string): {
    response: string;
    events: Array<{ type: string; data: Record<string, unknown> }>;
  } {
    const lines = raw.split('\n');
    const responseLines: string[] = [];
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and bare prompts
      if (trimmed === '' || trimmed === '>') continue;

      // Strip leading prompt characters from lines like "> some text"
      const cleaned = trimmed.startsWith('> ') ? trimmed.slice(2) : trimmed;

      // Try to parse as async event
      const event = parseAsyncEvent(cleaned);
      if (event) {
        events.push(event);
      } else {
        responseLines.push(line);
      }
    }

    return {
      response: responseLines.join('\n').trim(),
      events,
    };
  }
}
