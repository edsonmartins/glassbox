import { describe, it, expect, vi } from 'vitest';
import { EventStream } from '../src/events/event-stream.js';

// Use 'agent_thinking' instead of 'error' to avoid EventEmitter's special
// handling of the 'error' event (throws if no listener is attached).
const TEST_TYPE = 'agent_thinking' as const;
const TEST_DATA = { thought: 'testing' };

describe('EventStream', () => {
  it('starts with seq = 0', () => {
    const es = new EventStream();
    expect(es.getSeq()).toBe(0);
  });

  it('increments seq on each publish', () => {
    const es = new EventStream();
    es.publish(TEST_TYPE, 'ai', TEST_DATA);
    expect(es.getSeq()).toBe(1);
    es.publish(TEST_TYPE, 'ai', TEST_DATA);
    expect(es.getSeq()).toBe(2);
  });

  it('assigns correct seq numbers to returned events', () => {
    const es = new EventStream();
    const ev1 = es.publish(TEST_TYPE, 'ai', TEST_DATA);
    const ev2 = es.publish(TEST_TYPE, 'ai', TEST_DATA);
    expect(ev1.seq).toBe(0);
    expect(ev2.seq).toBe(1);
  });

  it('subscribe receives all events via wildcard', () => {
    const es = new EventStream();
    const received: unknown[] = [];
    es.subscribe((ev) => received.push(ev));

    es.publish(TEST_TYPE, 'ai', TEST_DATA);
    es.publish(TEST_TYPE, 'ai', TEST_DATA);

    expect(received).toHaveLength(2);
  });

  it('resets seq and generates a new sessionId', () => {
    const es = new EventStream();
    const originalSessionId = es.getSessionId();
    es.publish(TEST_TYPE, 'ai', TEST_DATA);
    expect(es.getSeq()).toBe(1);

    es.reset();
    expect(es.getSeq()).toBe(0);
    expect(es.getSessionId()).not.toBe(originalSessionId);
  });

  it('toJsonl serializes an event to a single JSON line', () => {
    const es = new EventStream();
    const ev = es.publish(TEST_TYPE, 'ai', TEST_DATA);
    const line = es.toJsonl(ev);
    expect(() => JSON.parse(line)).not.toThrow();
    const parsed = JSON.parse(line);
    expect(parsed.type).toBe(TEST_TYPE);
    expect(parsed.seq).toBe(0);
  });

  it('publishes the correct event fields', () => {
    const es = new EventStream();
    const ev = es.publish(TEST_TYPE, 'ai', TEST_DATA);
    expect(ev.type).toBe(TEST_TYPE);
    expect(ev.src).toBe('ai');
    expect(ev.data).toMatchObject(TEST_DATA);
    expect(ev.ts).toBeTruthy();
    expect(typeof ev.sessionId).toBe('string');
  });

  it('listeners on a specific type only fire for that type', () => {
    const es = new EventStream();
    const handler = vi.fn();
    es.on(TEST_TYPE, handler);

    es.publish(TEST_TYPE, 'ai', TEST_DATA);
    es.publish('control_change', 'user', { from: 'ai', to: 'user', reason: 'manual_takeover' });

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
