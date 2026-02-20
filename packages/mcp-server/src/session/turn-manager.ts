import type { ControlMode, TurnState } from './types.js';
import { MODES } from './types.js';
import { EventStream } from '../events/event-stream.js';

/**
 * TurnManager — controls who can act: AI, developer, or both.
 *
 * Implements RFC-005 (Turn Control). Three modes are supported:
 *
 *   - **autonomous** — AI drives, developer observes
 *   - **manual**     — developer drives, AI observes (but can still read)
 *   - **collaborative** — both can act simultaneously
 *
 * Every mode transition emits a `control_change` event onto the EventStream
 * so all consumers (TUI, log, extensions) stay synchronized.
 */
export class TurnManager {
  private mode: ControlMode = 'autonomous';
  private readonly eventStream: EventStream;

  // Collaborative conflict resolution (RFC-005)
  private pendingOperation: { actor: 'ai' | 'user'; op: string } | null = null;
  private userBreakpoints: Set<string> = new Set();

  // Inactivity timeout (RFC-005: collaborative → autonomous after 30s idle)
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly INACTIVITY_MS = 30_000;

  constructor(eventStream: EventStream) {
    this.eventStream = eventStream;
  }

  /**
   * Return the current control mode.
   */
  getMode(): ControlMode {
    return this.mode;
  }

  /**
   * Return the full TurnState descriptor for the current mode.
   */
  getState(): TurnState {
    return MODES[this.mode];
  }

  /**
   * Whether the AI agent is allowed to execute debug actions.
   */
  canAiAct(): boolean {
    return MODES[this.mode].aiCanAct;
  }

  /**
   * Whether the developer is allowed to execute debug actions.
   */
  canUserAct(): boolean {
    return MODES[this.mode].userCanAct;
  }

  // ── Collaborative Conflict Resolution (RFC-005) ──

  /**
   * Check whether an actor can execute an operation right now.
   * In collaborative mode, if an operation is already pending:
   *   - User always has priority (human > AI)
   *   - AI must wait if user has pending op
   */
  canExecute(actor: 'ai' | 'user'): boolean {
    if (this.mode !== 'collaborative') return true;
    if (!this.pendingOperation) return true;

    // User always has priority
    if (actor === 'user') return true;

    // AI must wait if any operation is pending
    return false;
  }

  /**
   * Mark an operation as in-progress for conflict detection.
   */
  beginOperation(actor: 'ai' | 'user', op: string): void {
    this.pendingOperation = { actor, op };
  }

  /**
   * Clear the pending operation.
   */
  endOperation(): void {
    this.pendingOperation = null;
  }

  /**
   * Track a breakpoint set by the user (protected from AI removal).
   */
  addUserBreakpoint(id: string): void {
    this.userBreakpoints.add(id);
  }

  /**
   * Check if a breakpoint is user-owned (protected).
   */
  isUserBreakpoint(id: string): boolean {
    return this.userBreakpoints.has(id);
  }

  /**
   * Remove a user breakpoint from tracking.
   */
  removeUserBreakpoint(id: string): void {
    this.userBreakpoints.delete(id);
  }

  // ── Inactivity Timeout (RFC-005) ──

  /**
   * Record that the user performed an action (resets inactivity timer).
   */
  recordUserActivity(): void {
    this.resetInactivityTimer();
  }

  /**
   * Stop the inactivity timer (e.g. when leaving collaborative mode).
   */
  clearInactivityTimer(): void {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }

  private resetInactivityTimer(): void {
    this.clearInactivityTimer();
    if (this.mode !== 'collaborative') return;

    this.inactivityTimer = setTimeout(() => {
      this.transfer('autonomous', 'User inactive for 30s');
    }, this.INACTIVITY_MS);
  }

  /**
   * Transfer control to a different mode.
   *
   * @param to     - The target ControlMode
   * @param reason - Human-readable reason for the transition
   */
  transfer(to: ControlMode, reason: string): void {
    const from = this.modeToControlSide(this.mode);
    const toSide = this.modeToControlSide(to);

    this.mode = to;

    // Manage inactivity timer based on new mode
    if (to === 'collaborative') {
      this.resetInactivityTimer();
    } else {
      this.clearInactivityTimer();
    }

    this.eventStream.publish('control_change', 'user', {
      from,
      to: toSide,
      reason: this.mapReason(reason),
    });
  }

  // ── Private helpers ──

  /**
   * Map a ControlMode to the event-level control side label.
   */
  private modeToControlSide(mode: ControlMode): 'ai' | 'user' | 'shared' {
    switch (mode) {
      case 'autonomous':
        return 'ai';
      case 'manual':
        return 'user';
      case 'collaborative':
        return 'shared';
    }
  }

  /**
   * Normalise a free-form reason string to the allowed ControlChangeEvent reasons.
   */
  private mapReason(
    reason: string,
  ): 'manual_takeover' | 'return_control' | 'session_start' | 'timeout' {
    const lower = reason.toLowerCase();
    if (lower.includes('takeover') || lower.includes('manual')) {
      return 'manual_takeover';
    }
    if (lower.includes('return') || lower.includes('back')) {
      return 'return_control';
    }
    if (lower.includes('start') || lower.includes('init')) {
      return 'session_start';
    }
    if (lower.includes('timeout') || lower.includes('inactive')) {
      return 'timeout';
    }
    // Default to manual_takeover for unrecognised reasons.
    return 'manual_takeover';
  }
}
