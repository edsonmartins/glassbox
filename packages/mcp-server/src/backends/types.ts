// ── Source Location ──
export interface SourceLocation {
  file: string;
  line: number;
  class: string;
  method: string;
}

// ── Launch / Attach ──
export interface LaunchConfig {
  projectDir: string;
  buildTool: 'maven' | 'gradle' | 'manual';
  mainClass?: string;
  jvmArgs?: string[];
  appArgs?: string[];
  port?: number;
  suspend?: boolean;
}

export interface AttachConfig {
  host?: string;
  port: number;
}

export interface LaunchResult {
  status: 'launched';
  pid: number;
  jdwpPort: number;
  mainClass: string;
  jdkVersion: string;
  buildTool: string;
  classpathEntries: number;
}

export interface AttachResult {
  status: 'attached';
  pid: number;
  jdkVersion: string;
  threads: number;
  loadedClasses: number;
}

export interface DisconnectResult {
  status: 'disconnected';
  sessionDurationMs: number;
  totalEvents: number;
  totalTokens: number;
}

// ── Stop Events ──
export type StopReason = 'breakpoint_hit' | 'exception_caught' | 'step_completed';

export interface StopEvent {
  status: 'stopped';
  reason: StopReason;
  location: SourceLocation;
  thread: string;
  exception?: {
    type: string;
    message: string | null;
  };
}

// ── Variables ──
export interface Variable {
  name: string;
  type: string;
  value: string;
  isNull: boolean;
  expandable: boolean;
  alert?: boolean;
}

// ── Eval ──
export interface EvalResult {
  expression: string;
  type: string;
  value: string;
  isNull: boolean;
}

// ── Inspect ──
export interface InspectResult {
  expression: string;
  type: string;
  value: unknown;
}

// ── Stack ──
export interface StackFrame {
  index: number;
  class: string;
  method: string;
  file: string | null;
  line: number;
  isUserCode: boolean;
}

export interface StacktraceResult {
  thread: string;
  frameCount: number;
  frames: StackFrame[];
}

// ── Threads ──
export interface ThreadInfo {
  id: string;
  name: string;
  state: string;
  isSuspended: boolean;
  isDaemon?: boolean;
  frameCount?: number;
}

export interface ThreadsResult {
  total: number;
  threads: ThreadInfo[];
}

// ── Breakpoints ──
export interface BreakpointInfo {
  status: 'set' | 'removed';
  id: string;
  file: string;
  line: number;
  condition: string | null;
  hitCount: number;
}

export interface CatchInfo {
  status: 'set';
  exception: string;
  caught: boolean;
  uncaught: boolean;
}

// ── Source ──
export interface SourceLine {
  n: number;
  text: string;
  isCurrent?: boolean;
  hasBreakpoint?: boolean;
}

export interface SourceResult {
  file: string;
  startLine: number;
  endLine: number;
  currentLine: number;
  lines: SourceLine[];
}

// ── Classes / Methods ──
export interface ClassInfo {
  name: string;
  isInterface?: boolean;
}

export interface MethodInfo {
  name: string;
  signature: string;
  modifiers?: string;
}

// ── Error ──
export interface DebugError {
  status: 'error';
  errorCode: string;
  message: string;
  details?: string;
}

// ── Debug Backend Interface ──
export interface DebugBackend {
  // Lifecycle
  launch(config: LaunchConfig): Promise<LaunchResult>;
  attach(config: AttachConfig): Promise<AttachResult>;
  disconnect(terminate?: boolean): Promise<DisconnectResult>;

  // Execution Control
  continue(threadId?: string): Promise<StopEvent>;
  stepOver(threadId: string): Promise<StopEvent>;
  stepInto(threadId: string, filterJdk?: boolean): Promise<StopEvent>;
  stepOut(threadId: string): Promise<StopEvent>;

  // Breakpoints
  setBreakpoint(file: string, line: number, condition?: string, hitCount?: number): Promise<BreakpointInfo>;
  removeBreakpoint(file: string, line: number): Promise<BreakpointInfo>;
  catchException(exceptionClass: string, caught?: boolean, uncaught?: boolean): Promise<CatchInfo>;

  // Inspection
  getLocals(threadId: string, frameIndex?: number, maxDepth?: number, maxElements?: number): Promise<Variable[]>;
  inspect(expression: string, threadId: string, frameIndex?: number, maxDepth?: number, maxStringLength?: number): Promise<InspectResult>;
  evaluate(expression: string, threadId: string, frameIndex?: number): Promise<EvalResult>;
  getStacktrace(threadId: string, maxFrames?: number, filterJdk?: boolean): Promise<StacktraceResult>;
  getThreads(includeDaemon?: boolean, includeSystem?: boolean): Promise<ThreadsResult>;

  // Source
  getSource(file: string, line: number, contextLines?: number): Promise<SourceResult>;

  // Classes / Methods
  listClasses(filter?: string): Promise<ClassInfo[]>;
  listMethods(className: string): Promise<MethodInfo[]>;

  // State
  isConnected(): boolean;

  // Events
  on(event: 'stopped', listener: (data: StopEvent) => void): void;
  on(event: 'disconnected', listener: () => void): void;
  on(event: 'output', listener: (text: string, stream: 'stdout' | 'stderr') => void): void;
}
