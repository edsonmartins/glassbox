import type {
  SessionPhase,
  SessionStats,
  BugRecord,
  SessionSummary,
  SessionComparison,
} from './types.js';
import { EventStream } from '../events/event-stream.js';

/** Cost per token in USD (approximate, for estimation). */
const COST_PER_TOKEN_USD = 0.00003;

/**
 * SessionManager — drives a debug session through its lifecycle phases.
 *
 * Phases follow RFC-006:
 *   SETUP -> HUNT -> FOUND -> FIX -> COMPLETE
 *
 * Tracks aggregate statistics (tool calls, tokens, bugs) and produces
 * a SessionSummary when the session completes.
 */
export class SessionManager {
  private phase: SessionPhase = 'setup';
  private stats: SessionStats = {
    toolCalls: 0,
    tokensUsed: 0,
    estimatedCostUsd: 0,
    eventsTotal: 0,
    bugsFound: 0,
  };
  private bugs: BugRecord[] = [];
  private startedAt: string = '';

  private readonly eventStream: EventStream;

  constructor(eventStream: EventStream) {
    this.eventStream = eventStream;

    // Count every event flowing through the stream.
    this.eventStream.subscribe(() => {
      this.stats.eventsTotal++;
    });
  }

  /**
   * Begin the session: record the start time and set phase to 'setup'.
   */
  start(): void {
    this.startedAt = new Date().toISOString();
    this.phase = 'setup';
  }

  /**
   * Transition to a new session phase.
   *
   * No enforcement of ordering is applied here — the caller (typically
   * the orchestration layer) is responsible for valid transitions.
   */
  transitionTo(phase: SessionPhase): void {
    this.phase = phase;
  }

  /**
   * Record that a tool call was made, consuming the given number of tokens.
   */
  recordToolCall(tokens: number): void {
    this.stats.toolCalls++;
    this.stats.tokensUsed += tokens;
    this.stats.estimatedCostUsd = this.stats.tokensUsed * COST_PER_TOKEN_USD;
  }

  /**
   * Record a discovered bug.
   */
  recordBug(bug: BugRecord): void {
    this.bugs.push(bug);
    this.stats.bugsFound = this.bugs.length;
  }

  /**
   * Finalize the session: set phase to 'complete', emit `session_ended`,
   * and return a full SessionSummary.
   */
  complete(): SessionSummary {
    this.phase = 'complete';

    const endedAt = new Date().toISOString();
    const durationMs =
      new Date(endedAt).getTime() - new Date(this.startedAt).getTime();

    this.eventStream.publish('session_ended', 'system', {
      durationMs,
      toolCalls: this.stats.toolCalls,
      tokensUsed: this.stats.tokensUsed,
      estimatedCostUsd: this.stats.estimatedCostUsd,
      bugsFound: this.stats.bugsFound,
    });

    // RFC-006: estimate savings vs. traditional manual debugging.
    const TOKENS_PER_TRADITIONAL_CALL = 500;
    const MINUTES_PER_TRADITIONAL_CALL = 2;
    const traditionalEstimatedTokens =
      this.stats.toolCalls * TOKENS_PER_TRADITIONAL_CALL;
    const traditionalEstimatedTimeMin =
      this.stats.toolCalls * MINUTES_PER_TRADITIONAL_CALL;
    const actualTimeMin = durationMs / 60_000;

    const comparison: SessionComparison = {
      traditionalEstimatedTokens,
      traditionalEstimatedTimeMin,
      tokenSavingsPct:
        traditionalEstimatedTokens > 0
          ? Math.round(
              ((traditionalEstimatedTokens - this.stats.tokensUsed) /
                traditionalEstimatedTokens) *
                100,
            )
          : 0,
      timeSavingsPct:
        traditionalEstimatedTimeMin > 0
          ? Math.round(
              ((traditionalEstimatedTimeMin - actualTimeMin) /
                traditionalEstimatedTimeMin) *
                100,
            )
          : 0,
    };

    return {
      sessionId: this.eventStream.getSessionId(),
      startedAt: this.startedAt,
      endedAt,
      durationMs,
      stats: { ...this.stats },
      bugs: [...this.bugs],
      comparison,
    };
  }

  /**
   * Return the current session phase.
   */
  getPhase(): SessionPhase {
    return this.phase;
  }

  /**
   * Return a snapshot of the current session statistics.
   */
  getStats(): SessionStats {
    return { ...this.stats };
  }

  /**
   * Return a partial summary (session may still be in progress).
   */
  getSummary(): SessionSummary {
    const now = new Date().toISOString();
    const durationMs =
      this.startedAt
        ? new Date(now).getTime() - new Date(this.startedAt).getTime()
        : 0;

    return {
      sessionId: this.eventStream.getSessionId(),
      startedAt: this.startedAt,
      endedAt: this.phase === 'complete' ? now : '',
      durationMs,
      stats: { ...this.stats },
      bugs: [...this.bugs],
    };
  }
}
