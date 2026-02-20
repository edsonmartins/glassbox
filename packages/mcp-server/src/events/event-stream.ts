import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { GlassboxEvent, GlassboxEventType, EventSource } from './types.js';

/**
 * EventStream — monotonic, session-scoped event bus for Glassbox.
 *
 * Every event gets an auto-incremented `seq`, ISO 8601 timestamp,
 * and the current `sessionId`. Consumers can subscribe to individual
 * event types or to the wildcard '*' channel that receives everything.
 *
 * Implements RFC-003 (Event Stream protocol).
 */
export class EventStream extends EventEmitter {
  private seq: number = 0;
  private sessionId: string;

  constructor() {
    super();
    this.sessionId = randomUUID();
  }

  /**
   * Publish a new event onto the stream.
   *
   * @param type  - The discriminated event type (e.g. 'breakpoint_hit')
   * @param src   - Origin of the event ('debugger' | 'ai' | 'user' | 'system')
   * @param data  - Event-specific payload
   * @returns The fully-formed GlassboxEvent that was emitted
   */
  publish<T extends GlassboxEventType>(
    type: T,
    src: EventSource,
    data: Extract<GlassboxEvent, { type: T }>['data'],
  ): Extract<GlassboxEvent, { type: T }> {
    const event = {
      ts: new Date().toISOString(),
      seq: this.seq++,
      sessionId: this.sessionId,
      src,
      type,
      data,
    } as Extract<GlassboxEvent, { type: T }>;

    this.emit(type, event);
    this.emit('*', event);

    return event;
  }

  /**
   * Subscribe to every event on the stream (wildcard listener).
   */
  subscribe(callback: (event: GlassboxEvent) => void): void {
    this.on('*', callback);
  }

  /**
   * Serialize an event to a single JSON line (JSONL format).
   */
  toJsonl(event: GlassboxEvent): string {
    return JSON.stringify(event);
  }

  /**
   * Return the current sequence number (next event will use this value).
   */
  getSeq(): number {
    return this.seq;
  }

  /**
   * Reset the stream: sequence back to 0 and a fresh sessionId.
   */
  reset(): void {
    this.seq = 0;
    this.sessionId = randomUUID();
  }

  /**
   * Return the current sessionId.
   */
  getSessionId(): string {
    return this.sessionId;
  }
}
