import type { SourceLocation } from '../backends/types.js';

// ── Base ──
export interface BaseEvent {
  ts: string;
  seq: number;
  sessionId: string;
  src: EventSource;
}

export type EventSource = 'debugger' | 'ai' | 'user' | 'system';

// ── Debugger Events ──
export interface SessionStartedEvent extends BaseEvent {
  type: 'session_started';
  src: 'debugger';
  data: {
    pid: number;
    jdkVersion: string;
    mainClass: string;
    jdwpPort: number;
  };
}

export interface SessionEndedEvent extends BaseEvent {
  type: 'session_ended';
  src: 'system';
  data: {
    durationMs: number;
    toolCalls: number;
    tokensUsed: number;
    estimatedCostUsd: number;
    bugsFound: number;
  };
}

export interface BreakpointHitEvent extends BaseEvent {
  type: 'breakpoint_hit';
  src: 'debugger';
  data: {
    breakpointId: string;
    location: SourceLocation;
    thread: string;
  };
}

export interface ExceptionCaughtEvent extends BaseEvent {
  type: 'exception_caught';
  src: 'debugger';
  data: {
    exceptionType: string;
    message: string | null;
    location: SourceLocation;
    thread: string;
    isCaught: boolean;
  };
}

export interface StepCompletedEvent extends BaseEvent {
  type: 'step_completed';
  src: 'debugger';
  data: {
    stepType: 'over' | 'into' | 'out';
    location: SourceLocation;
    thread: string;
  };
}

export interface ThreadStartedEvent extends BaseEvent {
  type: 'thread_started';
  src: 'debugger';
  data: { thread: string };
}

export interface ThreadDiedEvent extends BaseEvent {
  type: 'thread_died';
  src: 'debugger';
  data: { thread: string };
}

// ── AI Events ──
export interface AgentActionEvent extends BaseEvent {
  type: 'agent_action';
  src: 'ai';
  data: {
    tool: string;
    request: unknown;
    result: unknown;
    tokensUsed: number;
    durationMs: number;
  };
}

export interface AgentThinkingEvent extends BaseEvent {
  type: 'agent_thinking';
  src: 'ai';
  data: {
    thought: string;
  };
}

export interface DiagnosisEvent extends BaseEvent {
  type: 'diagnosis';
  src: 'ai';
  data: {
    bugId: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    title: string;
    rootCause: string;
    affectedLocation: SourceLocation;
    totalTokens: number;
    elapsedMs: number;
  };
}

export interface FixProposedEvent extends BaseEvent {
  type: 'fix_proposed';
  src: 'ai';
  data: {
    bugId: string;
    fixType: 'code_change' | 'config_change' | 'dependency_update';
    file: string;
    diff: string;
    explanation: string;
    confidence: number;
  };
}

// ── User Events ──
export interface ControlChangeEvent extends BaseEvent {
  type: 'control_change';
  src: 'user' | 'ai';
  data: {
    from: 'ai' | 'user' | 'shared';
    to: 'ai' | 'user' | 'shared';
    reason: 'manual_takeover' | 'return_control' | 'session_start' | 'timeout';
  };
}

export interface ManualStepEvent extends BaseEvent {
  type: 'manual_step';
  src: 'user';
  data: {
    action: string;
    location: SourceLocation;
    thread: string;
  };
}

export interface ManualEvalEvent extends BaseEvent {
  type: 'manual_eval';
  src: 'user';
  data: {
    expression: string;
    result: string;
  };
}

export interface FixAppliedEvent extends BaseEvent {
  type: 'fix_applied';
  src: 'user';
  data: {
    bugId: string;
    applied: boolean;
  };
}

// ── Breakpoint / Watch Events ──
export interface BreakpointAddedEvent extends BaseEvent {
  type: 'breakpoint_added';
  src: 'ai' | 'user';
  data: {
    breakpointId: string;
    file: string;
    line: number;
  };
}

export interface WatchAddedEvent extends BaseEvent {
  type: 'watch_added';
  src: 'user';
  data: {
    expression: string;
  };
}

// ── System Events ──
export interface AppStartedEvent extends BaseEvent {
  type: 'app_started';
  src: 'system';
  data: {
    pid: number;
    mainClass: string;
  };
}

export interface AppOutputEvent extends BaseEvent {
  type: 'app_stdout' | 'app_stderr';
  src: 'system';
  data: {
    text: string;
    truncated: boolean;
  };
}

export interface ErrorEvent extends BaseEvent {
  type: 'error';
  src: 'system';
  data: {
    code: string;
    message: string;
    details?: string;
  };
}

// ── Union Type ──
export type GlassboxEvent =
  | SessionStartedEvent
  | SessionEndedEvent
  | BreakpointHitEvent
  | ExceptionCaughtEvent
  | StepCompletedEvent
  | ThreadStartedEvent
  | ThreadDiedEvent
  | AgentActionEvent
  | AgentThinkingEvent
  | DiagnosisEvent
  | FixProposedEvent
  | ControlChangeEvent
  | ManualStepEvent
  | ManualEvalEvent
  | FixAppliedEvent
  | BreakpointAddedEvent
  | WatchAddedEvent
  | AppStartedEvent
  | AppOutputEvent
  | ErrorEvent;

export type GlassboxEventType = GlassboxEvent['type'];
