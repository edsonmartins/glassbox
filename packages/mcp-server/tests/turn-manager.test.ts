import { describe, it, expect } from 'vitest';
import { EventStream } from '../src/events/event-stream.js';
import { TurnManager } from '../src/session/turn-manager.js';

function makeManager() {
  const es = new EventStream();
  const tm = new TurnManager(es);
  return { es, tm };
}

describe('TurnManager', () => {
  it('starts in autonomous mode', () => {
    const { tm } = makeManager();
    expect(tm.getMode()).toBe('autonomous');
  });

  it('canAiAct() is true in autonomous mode', () => {
    const { tm } = makeManager();
    expect(tm.canAiAct()).toBe(true);
  });

  it('canUserAct() is false in autonomous mode', () => {
    const { tm } = makeManager();
    expect(tm.canUserAct()).toBe(false);
  });

  it('transfer() to manual blocks AI and allows user', () => {
    const { tm } = makeManager();
    tm.transfer('manual', 'manual takeover');
    expect(tm.getMode()).toBe('manual');
    expect(tm.canAiAct()).toBe(false);
    expect(tm.canUserAct()).toBe(true);
  });

  it('transfer() to collaborative allows both', () => {
    const { tm } = makeManager();
    tm.transfer('collaborative', 'start collaboration');
    expect(tm.canAiAct()).toBe(true);
    expect(tm.canUserAct()).toBe(true);
  });

  it('transfer() back to autonomous re-enables AI', () => {
    const { tm } = makeManager();
    tm.transfer('manual', 'manual takeover');
    tm.transfer('autonomous', 'return control');
    expect(tm.canAiAct()).toBe(true);
    expect(tm.canUserAct()).toBe(false);
  });

  it('getState() returns the correct TurnState descriptor', () => {
    const { tm } = makeManager();
    const state = tm.getState();
    expect(state.mode).toBe('autonomous');
    expect(state.aiCanAct).toBe(true);
    expect(state.aiCanRead).toBe(true);
  });

  it('transfer() emits a control_change event', () => {
    const { es, tm } = makeManager();
    const received: any[] = [];
    es.on('control_change', (ev: any) => received.push(ev));

    tm.transfer('manual', 'manual takeover');

    expect(received).toHaveLength(1);
    expect(received[0].data.from).toBe('ai');
    expect(received[0].data.to).toBe('user');
    expect(received[0].data.reason).toBe('manual_takeover');
  });

  it('reason mapping: "return control" maps to return_control', () => {
    const { es, tm } = makeManager();
    const received: any[] = [];
    es.on('control_change', (ev: any) => received.push(ev));
    tm.transfer('autonomous', 'return control back to ai');
    expect(received[0].data.reason).toBe('return_control');
  });

  it('reason mapping: "session init" maps to session_start', () => {
    const { es, tm } = makeManager();
    const received: any[] = [];
    es.on('control_change', (ev: any) => received.push(ev));
    tm.transfer('autonomous', 'session init');
    expect(received[0].data.reason).toBe('session_start');
  });

  it('unknown reason maps to manual_takeover as default', () => {
    const { es, tm } = makeManager();
    const received: any[] = [];
    es.on('control_change', (ev: any) => received.push(ev));
    tm.transfer('manual', 'some random reason');
    expect(received[0].data.reason).toBe('manual_takeover');
  });

  // ── Collaborative Conflict Resolution (RFC-005) ──

  describe('conflict resolution', () => {
    it('canExecute() returns true for both actors when no pending operation', () => {
      const { tm } = makeManager();
      tm.transfer('collaborative', 'start collaboration');
      expect(tm.canExecute('ai')).toBe(true);
      expect(tm.canExecute('user')).toBe(true);
    });

    it('canExecute() blocks AI when operation is pending', () => {
      const { tm } = makeManager();
      tm.transfer('collaborative', 'start collaboration');
      tm.beginOperation('user', 'step_over');
      expect(tm.canExecute('ai')).toBe(false);
      expect(tm.canExecute('user')).toBe(true);
    });

    it('canExecute() allows user even when AI operation is pending', () => {
      const { tm } = makeManager();
      tm.transfer('collaborative', 'start collaboration');
      tm.beginOperation('ai', 'evaluate');
      expect(tm.canExecute('user')).toBe(true);
      expect(tm.canExecute('ai')).toBe(false);
    });

    it('endOperation() clears pending and unblocks AI', () => {
      const { tm } = makeManager();
      tm.transfer('collaborative', 'start collaboration');
      tm.beginOperation('user', 'step_over');
      expect(tm.canExecute('ai')).toBe(false);
      tm.endOperation();
      expect(tm.canExecute('ai')).toBe(true);
    });

    it('canExecute() always returns true outside collaborative mode', () => {
      const { tm } = makeManager();
      // autonomous mode
      tm.beginOperation('user', 'step_over');
      expect(tm.canExecute('ai')).toBe(true);
      // manual mode
      tm.transfer('manual', 'manual takeover');
      expect(tm.canExecute('ai')).toBe(true);
    });
  });

  // ── User Breakpoint Protection ──

  describe('user breakpoint protection', () => {
    it('tracks user breakpoints', () => {
      const { tm } = makeManager();
      expect(tm.isUserBreakpoint('bp1')).toBe(false);
      tm.addUserBreakpoint('bp1');
      expect(tm.isUserBreakpoint('bp1')).toBe(true);
    });

    it('removeUserBreakpoint clears tracking', () => {
      const { tm } = makeManager();
      tm.addUserBreakpoint('bp1');
      tm.removeUserBreakpoint('bp1');
      expect(tm.isUserBreakpoint('bp1')).toBe(false);
    });
  });

  // ── Inactivity Timeout (RFC-005) ──

  describe('inactivity timeout', () => {
    it('recordUserActivity() does not throw outside collaborative mode', () => {
      const { tm } = makeManager();
      expect(() => tm.recordUserActivity()).not.toThrow();
    });

    it('clearInactivityTimer() is safe to call when no timer exists', () => {
      const { tm } = makeManager();
      expect(() => tm.clearInactivityTimer()).not.toThrow();
    });

    it('transfer to collaborative starts inactivity timer', () => {
      const { tm } = makeManager();
      tm.transfer('collaborative', 'start collaboration');
      // Timer is internal, but we can verify mode is set
      expect(tm.getMode()).toBe('collaborative');
      // Clean up timer to avoid test hanging
      tm.clearInactivityTimer();
    });

    it('transfer away from collaborative clears inactivity timer', () => {
      const { tm } = makeManager();
      tm.transfer('collaborative', 'start collaboration');
      tm.transfer('autonomous', 'return control');
      // No error, timer was cleared
      expect(tm.getMode()).toBe('autonomous');
    });

    it('reason mapping: "inactive" maps to timeout', () => {
      const { es, tm } = makeManager();
      const received: any[] = [];
      es.on('control_change', (ev: any) => received.push(ev));
      tm.transfer('autonomous', 'User inactive for 30s');
      expect(received[0].data.reason).toBe('timeout');
    });
  });
});
