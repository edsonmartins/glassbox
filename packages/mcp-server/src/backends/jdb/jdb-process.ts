import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

export interface JdbProcessEvents {
  data: [chunk: string];
  error: [err: Error];
  exit: [code: number | null, signal: NodeJS.Signals | null];
}

/**
 * Manages a JDB child process: spawning, writing commands, reading output,
 * and lifecycle management.
 *
 * Extends EventEmitter and emits:
 * - 'data'  (chunk: string)   — raw stdout text from JDB
 * - 'error' (err: Error)      — stderr output or process errors
 * - 'exit'  (code, signal)    — process exit
 */
export class JdbProcess extends EventEmitter {
  private process: ChildProcess | null = null;
  private alive = false;

  /**
   * Spawn JDB with the given arguments and wait for the initial `>` prompt,
   * indicating JDB is ready to accept commands.
   *
   * @param args - Arguments passed to the `jdb` command
   *   e.g. ['-connect', 'com.sun.jdi.SocketAttach:hostname=localhost,port=5005']
   */
  async start(args: string[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let resolved = false;
      let buffer = '';

      try {
        this.process = spawn('jdb', args, {
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) {
        reject(new Error(`Failed to spawn jdb: ${err}`));
        return;
      }

      this.alive = true;

      const startTimeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Timeout waiting for JDB initial prompt (30s)'));
          this.kill();
        }
      }, 30_000);

      const finish = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(startTimeout);
        resolve();
      };

      this.process.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        this.emit('data', text);

        // Before the initial prompt is found, accumulate to detect '>'
        if (!resolved) {
          buffer += text;
          // JDB prompt is '> ' at the start of a line, or just '>' followed by space
          if (/^> /m.test(buffer) || buffer.trimEnd().endsWith('>')) {
            finish();
          }
        }
      });

      this.process.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        this.emit('error', new Error(text));
      });

      this.process.on('error', (err: Error) => {
        this.alive = false;
        this.emit('error', err);
        if (!resolved) {
          resolved = true;
          clearTimeout(startTimeout);
          reject(err);
        }
      });

      this.process.on('exit', (code, signal) => {
        this.alive = false;
        this.emit('exit', code, signal);
        if (!resolved) {
          resolved = true;
          clearTimeout(startTimeout);
          reject(new Error(`JDB exited before ready (code=${code}, signal=${signal})`));
        }
      });
    });
  }

  /**
   * Write a command string to JDB's stdin. Appends a newline automatically.
   */
  write(command: string): void {
    if (!this.process || !this.alive) {
      throw new Error('JDB process is not running');
    }
    if (!this.process.stdin?.writable) {
      throw new Error('JDB stdin is not writable');
    }
    this.process.stdin.write(command + '\n');
  }

  /**
   * Kill the JDB process. Attempts graceful quit first, then SIGKILL after 2s.
   */
  kill(): void {
    if (!this.process) return;

    try {
      if (this.process.stdin?.writable) {
        this.process.stdin.write('quit\n');
      }
    } catch {
      // stdin may already be closed
    }

    const forceKillTimeout = setTimeout(() => {
      try {
        this.process?.kill('SIGKILL');
      } catch {
        // Process may already be dead
      }
    }, 2_000);

    this.process.once('exit', () => {
      clearTimeout(forceKillTimeout);
    });

    this.alive = false;
  }

  /**
   * Returns true if the JDB process is still running.
   */
  isAlive(): boolean {
    return this.alive;
  }

  /**
   * Returns the PID of the JDB process, or null if not running.
   */
  get pid(): number | null {
    return this.process?.pid ?? null;
  }
}
