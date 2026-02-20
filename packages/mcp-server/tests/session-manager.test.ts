import { describe, it, expect } from 'vitest';
import { EventStream } from '../src/events/event-stream.js';
import { SessionManager } from '../src/session/session-manager.js';

function makeManager() {
  const es = new EventStream();
  const sm = new SessionManager(es);
  return { es, sm };
}

describe('SessionManager', () => {
  it('starts in setup phase', () => {
    const { sm } = makeManager();
    expect(sm.getPhase()).toBe('setup');
  });

  it('start() records startedAt and durationMs >= 0', () => {
    const { sm } = makeManager();
    sm.start();
    expect(sm.getPhase()).toBe('setup');
    const summary = sm.getSummary();
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('transitionTo() changes the phase', () => {
    const { sm } = makeManager();
    sm.start();
    sm.transitionTo('hunt');
    expect(sm.getPhase()).toBe('hunt');
    sm.transitionTo('found');
    expect(sm.getPhase()).toBe('found');
  });

  it('recordToolCall() accumulates toolCalls and tokensUsed', () => {
    const { sm } = makeManager();
    sm.recordToolCall(100);
    sm.recordToolCall(200);
    const stats = sm.getStats();
    expect(stats.toolCalls).toBe(2);
    expect(stats.tokensUsed).toBe(300);
    expect(stats.estimatedCostUsd).toBeCloseTo(300 * 0.00003);
  });

  it('recordBug() increments bugsFound', () => {
    const { sm } = makeManager();
    sm.recordBug({
      id: 'bug-1',
      severity: 'HIGH',
      title: 'NPE in PedidoService',
      location: 'PedidoService.java:47',
      rootCause: 'cliente is null',
    });
    expect(sm.getStats().bugsFound).toBe(1);
  });

  it('complete() sets phase to complete and returns summary', () => {
    const { sm } = makeManager();
    sm.start();
    sm.recordToolCall(50);
    const summary = sm.complete();
    expect(sm.getPhase()).toBe('complete');
    expect(summary.stats.toolCalls).toBe(1);
    expect(summary.stats.tokensUsed).toBe(50);
    expect(summary.bugs).toEqual([]);
    expect(summary.endedAt).toBeTruthy();
  });

  it('complete() includes comparison field (RFC-006)', () => {
    const { sm } = makeManager();
    sm.start();
    sm.recordToolCall(100);
    const summary = sm.complete();
    expect(summary.comparison).toBeDefined();
    expect(summary.comparison!.traditionalEstimatedTokens).toBeGreaterThan(0);
    expect(summary.comparison!.traditionalEstimatedTimeMin).toBeGreaterThan(0);
    expect(typeof summary.comparison!.tokenSavingsPct).toBe('number');
    expect(typeof summary.comparison!.timeSavingsPct).toBe('number');
  });

  it('complete() emits session_ended event', () => {
    const { es, sm } = makeManager();
    const received: unknown[] = [];
    es.on('session_ended', (ev) => received.push(ev));
    sm.start();
    sm.complete();
    expect(received).toHaveLength(1);
  });

  it('eventsTotal increments for every event on the stream', () => {
    const { es, sm } = makeManager();
    es.publish('agent_thinking', 'ai', { thought: 'x' });
    es.publish('agent_thinking', 'ai', { thought: 'y' });
    expect(sm.getStats().eventsTotal).toBe(2);
  });
});
