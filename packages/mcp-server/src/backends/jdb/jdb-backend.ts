import { EventEmitter } from 'node:events';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { existsSync } from 'node:fs';

import { JdbProcess } from './jdb-process.js';
import { JdbCommandQueue } from './jdb-command-queue.js';
import {
  parseLocals,
  parseStacktrace,
  parseThreads,
  parseEval,
  parsePrint,
  parseList,
  parseBreakpointSet,
  parseClasses,
  parseMethods,
} from './jdb-parser.js';

import type {
  DebugBackend,
  LaunchConfig,
  LaunchResult,
  AttachConfig,
  AttachResult,
  DisconnectResult,
  StopEvent,
  StopReason,
  SourceLocation,
  Variable,
  EvalResult,
  InspectResult,
  StacktraceResult,
  ThreadsResult,
  BreakpointInfo,
  CatchInfo,
  SourceResult,
  SourceLine,
  ClassInfo,
  MethodInfo,
} from '../types.js';

/** Default JDWP port when none is specified. */
const DEFAULT_JDWP_PORT = 5005;

/** Timeout for commands that resume execution (cont, next, step, step up). */
const RESUME_TIMEOUT_MS = 120_000;

/** Timeout for inspection commands (locals, eval, print, where, threads). */
const INSPECT_TIMEOUT_MS = 10_000;

/**
 * JDB Backend — implements the DebugBackend interface using the JDB CLI.
 *
 * Manages the lifecycle of both the target Java application (when launched)
 * and the JDB debugger process. All JDB commands are serialised through
 * a JdbCommandQueue; asynchronous JDB events (breakpoint hits, exceptions,
 * thread events) are forwarded as typed events on this EventEmitter.
 */
export class JdbBackend extends EventEmitter implements DebugBackend {
  private jdbProcess: JdbProcess | null = null;
  private commandQueue: JdbCommandQueue | null = null;
  private connected = false;
  private launchedProcess: ChildProcess | null = null;
  private breakpointCounter = 0;
  private sourcePaths: string[] = [];
  /** Tracks active breakpoints as "className:lineNumber" for hasBreakpoint marking. */
  private activeBreakpoints = new Set<string>();
  /** Tracks conditional breakpoints: "className:lineNumber" → condition expression. */
  private breakpointConditions = new Map<string, string>();

  // Session tracking
  private sessionStartedAt = 0;
  private totalEvents = 0;
  private totalTokens = 0;

  // ── Lifecycle ──────────────────────────────────────────────────

  async launch(config: LaunchConfig): Promise<LaunchResult> {
    const projectDir = resolve(config.projectDir);
    const port = config.port ?? DEFAULT_JDWP_PORT;
    const suspend = config.suspend !== false; // default true

    // 1. Detect build tool
    const buildTool = this.detectBuildTool(projectDir, config.buildTool);

    // 2. Build the project
    await this.buildProject(projectDir, buildTool);

    // 3. Resolve main class and classpath
    const mainClass = config.mainClass ?? this.detectMainClass(projectDir, buildTool);
    const classpath = this.resolveClasspath(projectDir, buildTool);

    // 4. Compute source paths
    this.sourcePaths = this.resolveSourcePaths(projectDir);

    // 5. Start the Java app with JDWP agent
    const jdwpOpt =
      `-agentlib:jdwp=transport=dt_socket,server=y,suspend=${suspend ? 'y' : 'n'},address=*:${port}`;

    const jvmArgs = [jdwpOpt, ...(config.jvmArgs ?? [])];
    const appArgs = config.appArgs ?? [];

    this.launchedProcess = spawn(
      'java',
      [...jvmArgs, '-cp', classpath, mainClass, ...appArgs],
      {
        cwd: projectDir,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    // Forward application stdout/stderr
    this.launchedProcess.stdout?.on('data', (chunk: Buffer) => {
      this.emit('output', chunk.toString(), 'stdout');
    });
    this.launchedProcess.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      // JDWP prints "Listening for transport..." on stderr — not a real error
      this.emit('output', text, 'stderr');
    });

    // Wait a moment for the JDWP agent to start listening
    await this.waitForJdwpReady(port);

    // 6. Start JDB and attach to the target
    await this.startJdb('localhost', port);

    // 7. Set source paths via JDB use command
    if (this.sourcePaths.length > 0) {
      await this.commandQueue!.execute(
        `use ${this.sourcePaths.join(':')}`,
        INSPECT_TIMEOUT_MS,
      );
    }

    this.sessionStartedAt = Date.now();

    const pid = this.launchedProcess.pid ?? 0;
    const jdkVersion = await this.detectJdkVersion();
    const classpathEntries = classpath.split(':').length;

    return {
      status: 'launched',
      pid,
      jdwpPort: port,
      mainClass,
      jdkVersion,
      buildTool,
      classpathEntries,
    };
  }

  async attach(config: AttachConfig): Promise<AttachResult> {
    const host = config.host ?? 'localhost';
    const port = config.port;

    await this.startJdb(host, port);
    this.sessionStartedAt = Date.now();

    // Gather VM info
    const jdkVersion = await this.detectJdkVersion();
    const threadsResult = await this.getThreads(true, true);
    const pid = await this.detectRemotePid();

    return {
      status: 'attached',
      pid,
      jdkVersion,
      threads: threadsResult.total,
      loadedClasses: await this.countLoadedClasses(),
    };
  }

  async disconnect(terminate?: boolean): Promise<DisconnectResult> {
    const sessionDurationMs = Date.now() - this.sessionStartedAt;

    try {
      if (this.commandQueue && this.connected) {
        await this.commandQueue.execute('quit', 3_000).catch(() => {});
      }
    } catch {
      // JDB may already be gone
    }

    if (this.jdbProcess) {
      this.jdbProcess.kill();
      this.jdbProcess = null;
    }

    if (terminate && this.launchedProcess) {
      this.launchedProcess.kill('SIGTERM');
      // Force kill after 3 seconds if still alive
      const forceKillTimeout = setTimeout(() => {
        try {
          this.launchedProcess?.kill('SIGKILL');
        } catch {
          // already dead
        }
      }, 3_000);
      this.launchedProcess.once('exit', () => clearTimeout(forceKillTimeout));
      this.launchedProcess = null;
    }

    this.connected = false;
    this.commandQueue = null;
    this.emit('disconnected');

    return {
      status: 'disconnected',
      sessionDurationMs,
      totalEvents: this.totalEvents,
      totalTokens: this.totalTokens,
    };
  }

  // ── Execution Control ──────────────────────────────────────────

  async continue(threadId?: string): Promise<StopEvent> {
    this.ensureConnected();

    const command = threadId ? `thread ${threadId}\ncont` : 'cont';
    const output = await this.commandQueue!.execute(command, RESUME_TIMEOUT_MS);
    return this.parseStopEventFromOutput(output, 'breakpoint_hit');
  }

  async stepOver(threadId: string): Promise<StopEvent> {
    this.ensureConnected();

    await this.switchThread(threadId);
    const output = await this.commandQueue!.execute('next', RESUME_TIMEOUT_MS);
    return this.parseStopEventFromOutput(output, 'step_completed');
  }

  /**
   * @param _filterJdk - Accepted for API compatibility; JDB `step` command
   *   does not support class filters. Ignored in this backend.
   */
  async stepInto(threadId: string, _filterJdk?: boolean): Promise<StopEvent> {
    this.ensureConnected();

    await this.switchThread(threadId);
    const output = await this.commandQueue!.execute('step', RESUME_TIMEOUT_MS);
    return this.parseStopEventFromOutput(output, 'step_completed');
  }

  async stepOut(threadId: string): Promise<StopEvent> {
    this.ensureConnected();

    await this.switchThread(threadId);
    const output = await this.commandQueue!.execute('step up', RESUME_TIMEOUT_MS);
    return this.parseStopEventFromOutput(output, 'step_completed');
  }

  // ── Breakpoints ────────────────────────────────────────────────

  async setBreakpoint(
    file: string,
    line: number,
    condition?: string,
    hitCount?: number,
  ): Promise<BreakpointInfo> {
    this.ensureConnected();

    const className = this.fileToClassName(file);
    const command = `stop at ${className}:${line}`;
    const output = await this.commandQueue!.execute(command, INSPECT_TIMEOUT_MS);

    const parsed = parseBreakpointSet(output);
    this.breakpointCounter++;
    const id = `bp-${this.breakpointCounter}`;
    this.activeBreakpoints.add(`${parsed.class}:${parsed.line}`);

    // JDB doesn't natively support conditions on breakpoints via stop at,
    // but we track them and evaluate on hit (client-side conditional BP).
    const conditionStr = condition ?? null;
    const hitCountVal = hitCount ?? 0;

    if (condition) {
      this.breakpointConditions.set(`${parsed.class}:${parsed.line}`, condition);
    }

    return {
      status: 'set',
      id,
      file: parsed.class,
      line: parsed.line,
      condition: conditionStr,
      hitCount: hitCountVal,
    };
  }

  async removeBreakpoint(file: string, line: number): Promise<BreakpointInfo> {
    this.ensureConnected();

    const className = this.fileToClassName(file);
    const command = `clear ${className}:${line}`;
    await this.commandQueue!.execute(command, INSPECT_TIMEOUT_MS);
    this.activeBreakpoints.delete(`${className}:${line}`);
    this.breakpointConditions.delete(`${className}:${line}`);

    return {
      status: 'removed',
      id: '',
      file: className,
      line,
      condition: null,
      hitCount: 0,
    };
  }

  async catchException(
    exceptionClass: string,
    caught?: boolean,
    uncaught?: boolean,
  ): Promise<CatchInfo> {
    this.ensureConnected();

    const shouldCatch = caught !== false;  // default true
    const shouldUncaught = uncaught !== false;  // default true

    // JDB catch command catches all occurrences; there is no built-in
    // caught-only / uncaught-only distinction via CLI, so we issue the
    // command and record the intent.
    const command = `catch ${exceptionClass}`;
    await this.commandQueue!.execute(command, INSPECT_TIMEOUT_MS);

    return {
      status: 'set',
      exception: exceptionClass,
      caught: shouldCatch,
      uncaught: shouldUncaught,
    };
  }

  // ── Inspection ─────────────────────────────────────────────────

  /**
   * @param _maxDepth    - Accepted for API compatibility; JDB `locals` returns
   *   all variables at their default depth. Ignored in this backend.
   * @param _maxElements - Accepted for API compatibility; JDB `locals` returns
   *   all elements. Ignored in this backend.
   */
  async getLocals(
    threadId: string,
    frameIndex?: number,
    _maxDepth?: number,
    _maxElements?: number,
  ): Promise<Variable[]> {
    this.ensureConnected();

    await this.switchThread(threadId);

    // Navigate to the requested frame if not the top frame
    if (frameIndex && frameIndex > 0) {
      await this.commandQueue!.execute(`up ${frameIndex}`, INSPECT_TIMEOUT_MS);
    }

    const output = await this.commandQueue!.execute('locals', INSPECT_TIMEOUT_MS);

    // Navigate back to the top frame if we moved
    if (frameIndex && frameIndex > 0) {
      await this.commandQueue!.execute(`down ${frameIndex}`, INSPECT_TIMEOUT_MS);
    }

    return parseLocals(output);
  }

  /**
   * @param _maxDepth       - Accepted for API compatibility; JDB `dump`
   *   expands to whatever depth the JVM provides. Ignored in this backend.
   * @param _maxStringLength - Accepted for API compatibility; JDB `dump`
   *   does not truncate strings. Ignored in this backend.
   */
  async inspect(
    expression: string,
    threadId: string,
    frameIndex?: number,
    _maxDepth?: number,
    _maxStringLength?: number,
  ): Promise<InspectResult> {
    this.ensureConnected();

    await this.switchThread(threadId);

    if (frameIndex && frameIndex > 0) {
      await this.commandQueue!.execute(`up ${frameIndex}`, INSPECT_TIMEOUT_MS);
    }

    const output = await this.commandQueue!.execute(
      `dump ${expression}`,
      INSPECT_TIMEOUT_MS,
    );

    if (frameIndex && frameIndex > 0) {
      await this.commandQueue!.execute(`down ${frameIndex}`, INSPECT_TIMEOUT_MS);
    }

    return parsePrint(output);
  }

  async evaluate(
    expression: string,
    threadId: string,
    frameIndex?: number,
  ): Promise<EvalResult> {
    this.ensureConnected();

    await this.switchThread(threadId);

    if (frameIndex && frameIndex > 0) {
      await this.commandQueue!.execute(`up ${frameIndex}`, INSPECT_TIMEOUT_MS);
    }

    const output = await this.commandQueue!.execute(
      `eval ${expression}`,
      INSPECT_TIMEOUT_MS,
    );

    if (frameIndex && frameIndex > 0) {
      await this.commandQueue!.execute(`down ${frameIndex}`, INSPECT_TIMEOUT_MS);
    }

    return parseEval(output);
  }

  async getStacktrace(
    threadId: string,
    maxFrames?: number,
    filterJdk?: boolean,
  ): Promise<StacktraceResult> {
    this.ensureConnected();

    await this.switchThread(threadId);
    const output = await this.commandQueue!.execute('where', INSPECT_TIMEOUT_MS);
    let frames = parseStacktrace(output);

    if (filterJdk) {
      frames = frames.filter((f) => f.isUserCode);
    }

    if (maxFrames && maxFrames > 0) {
      frames = frames.slice(0, maxFrames);
    }

    return {
      thread: threadId,
      frameCount: frames.length,
      frames,
    };
  }

  async getThreads(
    includeDaemon?: boolean,
    includeSystem?: boolean,
  ): Promise<ThreadsResult> {
    this.ensureConnected();

    const output = await this.commandQueue!.execute('threads', INSPECT_TIMEOUT_MS);
    let threads = parseThreads(output);

    // Filter based on options (defaults: includeDaemon=true, includeSystem=false)
    if (includeDaemon === false) {
      threads = threads.filter((t) => !t.isDaemon);
    }

    if (!includeSystem) {
      // System threads are typically in the "system" group — the parser
      // marks them as daemon. We filter threads whose names suggest they
      // are JVM-internal (Reference Handler, Finalizer, Signal Dispatcher).
      const systemNames = [
        'Reference Handler',
        'Finalizer',
        'Signal Dispatcher',
        'Notification Thread',
      ];
      threads = threads.filter((t) => !systemNames.includes(t.name));
    }

    return {
      total: threads.length,
      threads,
    };
  }

  // ── Source ─────────────────────────────────────────────────────

  async getSource(
    file: string,
    line: number,
    contextLines?: number,
  ): Promise<SourceResult> {
    const ctx = contextLines ?? 10;
    const startLine = Math.max(1, line - ctx);
    const endLine = line + ctx;

    // Try to read from source paths on disk first
    const className = this.fileToClassName(file);
    const diskLines = await this.readSourceFromDisk(file, startLine, endLine);
    if (diskLines) {
      const sourceLines: SourceLine[] = diskLines.map((text, i) => {
        const n = startLine + i;
        const entry: SourceLine = { n, text };
        if (n === line) entry.isCurrent = true;
        if (this.activeBreakpoints.has(`${className}:${n}`)) entry.hasBreakpoint = true;
        return entry;
      });

      return {
        file,
        startLine,
        endLine: startLine + diskLines.length - 1,
        currentLine: line,
        lines: sourceLines,
      };
    }

    // Fallback: use JDB list command
    if (this.connected && this.commandQueue) {
      const output = await this.commandQueue.execute(
        `list ${file}:${line}`,
        INSPECT_TIMEOUT_MS,
      );
      const parsedLines = parseList(output);

      // Mark lines that have active breakpoints
      for (const sl of parsedLines) {
        if (this.activeBreakpoints.has(`${className}:${sl.n}`)) {
          sl.hasBreakpoint = true;
        }
      }

      if (parsedLines.length > 0) {
        return {
          file,
          startLine: parsedLines[0].n,
          endLine: parsedLines[parsedLines.length - 1].n,
          currentLine: line,
          lines: parsedLines,
        };
      }
    }

    // Nothing found
    return {
      file,
      startLine: line,
      endLine: line,
      currentLine: line,
      lines: [],
    };
  }

  // ── State ──────────────────────────────────────────────────────

  isConnected(): boolean {
    return this.connected;
  }

  // ── Event Forwarding (overloads for type safety) ───────────────

  on(event: 'stopped', listener: (data: StopEvent) => void): this;
  on(event: 'disconnected', listener: () => void): this;
  on(event: 'output', listener: (text: string, stream: 'stdout' | 'stderr') => void): this;
  on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  // ── Private Helpers ────────────────────────────────────────────

  /**
   * Start the JDB process and connect to the target JVM via SocketAttach.
   */
  private async startJdb(host: string, port: number): Promise<void> {
    this.jdbProcess = new JdbProcess();
    const connectArg = `com.sun.jdi.SocketAttach:hostname=${host},port=${port}`;

    await this.jdbProcess.start(['-connect', connectArg]);

    this.commandQueue = new JdbCommandQueue(this.jdbProcess);
    this.connected = true;

    // Forward async events from the command queue
    this.commandQueue.on('async_event', (event: { type: string; data: Record<string, unknown> }) => {
      this.totalEvents++;
      this.forwardAsyncEvent(event);
    });

    // Handle JDB process exit
    this.jdbProcess.on('exit', () => {
      this.connected = false;
      this.emit('disconnected');
    });
  }

  /**
   * Forward a parsed async event from JdbCommandQueue as a typed event on
   * this backend.
   */
  private forwardAsyncEvent(event: { type: string; data: Record<string, unknown> }): void {
    if (
      event.type === 'breakpoint_hit' ||
      event.type === 'exception_caught' ||
      event.type === 'exception_uncaught' ||
      event.type === 'step_completed'
    ) {
      const data = event.data;
      const reason: StopReason =
        event.type === 'breakpoint_hit'
          ? 'breakpoint_hit'
          : event.type === 'step_completed'
            ? 'step_completed'
            : 'exception_caught';

      const location: SourceLocation = {
        file: String(data.class ?? '').split('.').pop() + '.java',
        line: Number(data.line ?? 0),
        class: String(data.class ?? ''),
        method: String(data.method ?? ''),
      };

      const stopEvent: StopEvent = {
        status: 'stopped',
        reason,
        location,
        thread: String(data.thread ?? ''),
      };

      // Add exception info for exception events
      if (event.type === 'exception_caught' || event.type === 'exception_uncaught') {
        stopEvent.exception = {
          type: String(data.exceptionType ?? ''),
          message: null,
        };
      }

      // Conditional breakpoint workaround: if the breakpoint has a condition,
      // evaluate it and auto-continue if the condition is false.
      if (event.type === 'breakpoint_hit') {
        const bpKey = `${data.class}:${data.line}`;
        const condition = this.breakpointConditions.get(bpKey);
        if (condition && this.commandQueue) {
          // Evaluate condition asynchronously; if false, resume without emitting
          this.commandQueue
            .execute(`eval ${condition}`, INSPECT_TIMEOUT_MS)
            .then((evalOutput) => {
              const evalResult = parseEval(evalOutput);
              if (evalResult.value === 'false') {
                // Condition not met — auto-continue
                return this.commandQueue!.execute('cont', RESUME_TIMEOUT_MS);
              }
              // Condition met or couldn't evaluate — emit the stop event
              this.emit('stopped', stopEvent);
            })
            .catch(() => {
              // If eval fails, emit stop event anyway
              this.emit('stopped', stopEvent);
            });
          return; // Don't emit yet — the promise chain will decide
        }
      }

      this.emit('stopped', stopEvent);
    }

    // VM disconnect / death
    if (event.type === 'vm_disconnected' || event.type === 'vm_death') {
      this.connected = false;
      this.emit('disconnected');
    }
  }

  /**
   * Parse a StopEvent from the raw output of a resume command (cont, next,
   * step, step up). The command queue may have already emitted the event
   * via async_event, but we also parse the output directly to return
   * synchronously from the method.
   */
  private parseStopEventFromOutput(output: string, defaultReason: StopReason): StopEvent {
    // Try to find a breakpoint hit or step completed pattern in the output
    const bpMatch = output.match(
      /Breakpoint hit: "thread=(.+?)",\s*(.+?)\.(\w+)\(\),\s*line=(\d+)/,
    );
    if (bpMatch) {
      const className = bpMatch[2];
      return {
        status: 'stopped',
        reason: 'breakpoint_hit',
        location: {
          file: className.split('.').pop() + '.java',
          line: parseInt(bpMatch[4], 10),
          class: className,
          method: bpMatch[3],
        },
        thread: bpMatch[1],
      };
    }

    const stepMatch = output.match(
      /Step completed: "thread=(.+?)",\s*(.+?)\.(\w+)\(\),\s*line=(\d+)/,
    );
    if (stepMatch) {
      const className = stepMatch[2];
      return {
        status: 'stopped',
        reason: 'step_completed',
        location: {
          file: className.split('.').pop() + '.java',
          line: parseInt(stepMatch[4], 10),
          class: className,
          method: stepMatch[3],
        },
        thread: stepMatch[1],
      };
    }

    const exMatch = output.match(
      /Exception occurred: (.+?) \((?:to be caught at: (.+?)|uncaught)\)/,
    );
    if (exMatch) {
      return {
        status: 'stopped',
        reason: 'exception_caught',
        location: {
          file: '',
          line: 0,
          class: '',
          method: '',
        },
        thread: '',
        exception: {
          type: exMatch[1],
          message: null,
        },
      };
    }

    // Fallback: return a minimal stop event using any location info we can find
    // from the output (JDB sometimes prints "main[1]" or "thread[1]" style prompts)
    const threadPromptMatch = output.match(/^(\S+)\[\d+\]/m);
    const threadName = threadPromptMatch ? threadPromptMatch[1] : '';

    return {
      status: 'stopped',
      reason: defaultReason,
      location: {
        file: '',
        line: 0,
        class: '',
        method: '',
      },
      thread: threadName,
    };
  }

  /**
   * Switch the JDB context to a specific thread.
   */
  private async switchThread(threadId: string): Promise<void> {
    await this.commandQueue!.execute(`thread ${threadId}`, INSPECT_TIMEOUT_MS);
  }

  /**
   * Ensure the backend is connected; throw if not.
   */
  private ensureConnected(): void {
    if (!this.connected || !this.commandQueue) {
      throw new Error('JDB backend is not connected. Call launch() or attach() first.');
    }
  }

  /**
   * Detect the build tool for the project.
   */
  private detectBuildTool(
    projectDir: string,
    configuredTool: 'maven' | 'gradle' | 'manual',
  ): 'maven' | 'gradle' | 'manual' {
    if (configuredTool !== 'manual') return configuredTool;

    if (existsSync(join(projectDir, 'pom.xml'))) return 'maven';
    if (
      existsSync(join(projectDir, 'build.gradle')) ||
      existsSync(join(projectDir, 'build.gradle.kts'))
    ) {
      return 'gradle';
    }

    return 'manual';
  }

  /**
   * Build the project using the detected build tool.
   */
  private async buildProject(
    projectDir: string,
    buildTool: 'maven' | 'gradle' | 'manual',
  ): Promise<void> {
    if (buildTool === 'manual') return;

    const command =
      buildTool === 'maven'
        ? 'mvn compile -q'
        : 'gradle build -q';

    try {
      execSync(command, {
        cwd: projectDir,
        stdio: 'pipe',
        timeout: 120_000,
      });
    } catch (err: any) {
      const stderr = err.stderr?.toString() ?? '';
      const stdout = err.stdout?.toString() ?? '';
      throw new Error(
        `Build failed (${buildTool}): ${stderr || stdout || String(err)}`,
      );
    }
  }

  /**
   * Attempt to detect the main class from the project configuration.
   */
  private detectMainClass(
    projectDir: string,
    buildTool: 'maven' | 'gradle' | 'manual',
  ): string {
    if (buildTool === 'maven') {
      try {
        const pomPath = join(projectDir, 'pom.xml');
        const pom = execSync(`cat "${pomPath}"`, { encoding: 'utf-8' });
        const mainClassMatch = pom.match(/<mainClass>(.+?)<\/mainClass>/);
        if (mainClassMatch) return mainClassMatch[1];
      } catch {
        // fall through
      }
    }

    throw new Error(
      'Could not detect main class. Please provide mainClass in the launch configuration.',
    );
  }

  /**
   * Resolve the classpath for the project.
   */
  private resolveClasspath(
    projectDir: string,
    buildTool: 'maven' | 'gradle' | 'manual',
  ): string {
    if (buildTool === 'maven') {
      try {
        const cp = execSync(
          'mvn dependency:build-classpath -Dmdep.outputFile=/dev/stdout -q',
          { cwd: projectDir, encoding: 'utf-8', timeout: 60_000 },
        ).trim();
        const targetClasses = join(projectDir, 'target', 'classes');
        return `${targetClasses}:${cp}`;
      } catch {
        // Fallback to target/classes only
        return join(projectDir, 'target', 'classes');
      }
    }

    if (buildTool === 'gradle') {
      try {
        const cp = execSync(
          "gradle -q printClasspath 2>/dev/null || gradle -q dependencies --configuration runtimeClasspath 2>/dev/null || echo ''",
          { cwd: projectDir, encoding: 'utf-8', timeout: 60_000 },
        ).trim();
        const buildClasses = join(projectDir, 'build', 'classes', 'java', 'main');
        return cp ? `${buildClasses}:${cp}` : buildClasses;
      } catch {
        return join(projectDir, 'build', 'classes', 'java', 'main');
      }
    }

    // Manual: assume current directory
    return '.';
  }

  /**
   * Resolve source paths for the project (used by JDB `list` and disk reads).
   */
  private resolveSourcePaths(projectDir: string): string[] {
    const candidates = [
      join(projectDir, 'src', 'main', 'java'),
      join(projectDir, 'src', 'main', 'kotlin'),
      join(projectDir, 'src', 'test', 'java'),
      join(projectDir, 'src'),
    ];
    return candidates.filter((p) => existsSync(p));
  }

  /**
   * Wait for the JDWP agent on the target JVM to be ready.
   */
  private async waitForJdwpReady(port: number): Promise<void> {
    const maxAttempts = 30;
    const delayMs = 500;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        // Try to connect briefly using a raw TCP check
        await new Promise<void>((resolve, reject) => {
          const net = require('node:net');
          const socket = net.createConnection({ port, host: 'localhost' }, () => {
            socket.destroy();
            resolve();
          });
          socket.on('error', () => {
            reject();
          });
          socket.setTimeout(500, () => {
            socket.destroy();
            reject();
          });
        });
        return; // connection succeeded
      } catch {
        await this.delay(delayMs);
      }
    }

    throw new Error(
      `Timeout waiting for JDWP agent on port ${port} (${maxAttempts * delayMs}ms)`,
    );
  }

  /**
   * Detect the JDK version via JDB version command.
   */
  private async detectJdkVersion(): Promise<string> {
    if (!this.commandQueue) return 'unknown';

    try {
      const output = await this.commandQueue.execute('version', INSPECT_TIMEOUT_MS);
      // JDB version output typically includes the JDK version string
      const versionMatch = output.match(/(\d+\.\d+[\.\d]*)/);
      return versionMatch ? versionMatch[1] : 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Try to detect the remote PID (best effort).
   *
   * JDB CLI does not expose the remote process PID — there is no `pid`
   * command. This always returns 0. The limitation is inherent to the
   * JDB CLI interface and would require a JDI Bridge to resolve.
   */
  private async detectRemotePid(): Promise<number> {
    return 0;
  }

  // ── Classes / Methods ──────────────────────────────────────

  /**
   * List loaded classes, optionally filtered by a substring.
   */
  async listClasses(filter?: string): Promise<ClassInfo[]> {
    if (!this.commandQueue) {
      throw new Error('No active JDB session');
    }

    const output = await this.commandQueue.execute('classes', INSPECT_TIMEOUT_MS);
    let classes = parseClasses(output);

    if (filter) {
      const lower = filter.toLowerCase();
      classes = classes.filter((c) => c.name.toLowerCase().includes(lower));
    }

    return classes;
  }

  /**
   * List methods for a given class.
   */
  async listMethods(className: string): Promise<MethodInfo[]> {
    if (!this.commandQueue) {
      throw new Error('No active JDB session');
    }

    const output = await this.commandQueue.execute(
      `methods ${className}`,
      INSPECT_TIMEOUT_MS,
    );
    return parseMethods(output);
  }

  /**
   * Count loaded classes (best effort via JDB classes command).
   */
  private async countLoadedClasses(): Promise<number> {
    if (!this.commandQueue) return 0;

    try {
      const output = await this.commandQueue.execute('classes', INSPECT_TIMEOUT_MS);
      // Count lines that look like class entries
      const lines = output.split('\n').filter((l) => l.trim().length > 0);
      return lines.length;
    } catch {
      return 0;
    }
  }

  /**
   * Convert a file name or path to a JDB-compatible class name.
   *
   * Examples:
   *   "PedidoService.java"          → "PedidoService" (JDB resolves)
   *   "com/example/PedidoService.java" → "com.example.PedidoService"
   *   "com.example.PedidoService"   → "com.example.PedidoService" (already FQCN)
   */
  private fileToClassName(file: string): string {
    // If already a fully qualified class name (contains dots, no slashes, no .java)
    if (file.includes('.') && !file.includes('/') && !file.endsWith('.java')) {
      return file;
    }

    // Remove .java extension
    let name = file.replace(/\.java$/, '');

    // Replace path separators with dots
    name = name.replace(/\//g, '.').replace(/\\/g, '.');

    // Remove leading dots
    name = name.replace(/^\.+/, '');

    // If the name starts with src.main.java. strip that prefix
    name = name.replace(/^src\.main\.java\./, '');

    return name;
  }

  /**
   * Read source lines from disk by searching the configured source paths.
   */
  private async readSourceFromDisk(
    file: string,
    startLine: number,
    endLine: number,
  ): Promise<string[] | null> {
    // Determine possible file paths
    const candidates: string[] = [];

    for (const srcPath of this.sourcePaths) {
      // Try the file as-is
      candidates.push(join(srcPath, file));

      // Try converting FQCN to path: com.example.Class → com/example/Class.java
      if (!file.includes(sep) && !file.includes('/')) {
        const asPath = file.replace(/\./g, '/');
        candidates.push(join(srcPath, asPath + '.java'));
        candidates.push(join(srcPath, asPath));
      }
    }

    // Also try the file as an absolute path
    if (file.startsWith('/')) {
      candidates.push(file);
    }

    for (const candidate of candidates) {
      try {
        const content = await readFile(candidate, 'utf-8');
        const allLines = content.split('\n');
        // startLine and endLine are 1-based
        const slice = allLines.slice(startLine - 1, endLine);
        return slice;
      } catch {
        // File not found at this path, try next
      }
    }

    return null;
  }

  /**
   * Utility: delay for N milliseconds.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
