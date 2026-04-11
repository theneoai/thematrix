import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from './bus.js';
import { SQLiteEventStore } from './store.js';
import type { DomainEvent } from '@thematrix/types';

describe('EventBus', () => {
  const createEventBus = () => {
    const store = new SQLiteEventStore(':memory:');
    const bus = new EventBus(store);
    return { bus, store };
  };

  describe('publish', () => {
    it('should publish an event', async () => {
      const { bus } = createEventBus();
      const event: DomainEvent = {
        eventId: 'evt-test',
        type: 'test.event',
        source: { kind: 'system', id: 'test' },
        timestamp: new Date(),
        payload: { data: 'test' },
        correlationId: 'corr-test',
      };

      await expect(bus.publish(event)).resolves.not.toThrow();
    });
  });

  describe('subscribe', () => {
    it('should receive matching events', async () => {
      const { bus } = createEventBus();
      const handler = vi.fn();

      bus.subscribe('test.event', handler);

      const event: DomainEvent = {
        eventId: 'evt-test',
        type: 'test.event',
        source: { kind: 'system', id: 'test' },
        timestamp: new Date(),
        payload: { data: 'test' },
        correlationId: 'corr-test',
      };

      await bus.publish(event);

      // Wait for async handler
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(handler).toHaveBeenCalledWith(event);
    });

    it('should unsubscribe correctly', async () => {
      const { bus } = createEventBus();
      const handler = vi.fn();

      const unsubscribe = bus.subscribe('test.event', handler);
      unsubscribe();

      const event: DomainEvent = {
        eventId: 'evt-test',
        type: 'test.event',
        source: { kind: 'system', id: 'test' },
        timestamp: new Date(),
        payload: { data: 'test' },
        correlationId: 'corr-test',
      };

      await bus.publish(event);

      // Wait for async handler
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('createEvent', () => {
    it('should create an event with generated ID', () => {
      const { bus } = createEventBus();
      const event = bus.createEvent(
        'test.event',
        { kind: 'system', id: 'test' },
        { data: 'test' },
        'corr-test'
      );

      expect(event.type).toBe('test.event');
      expect(event.source.kind).toBe('system');
      expect(event.source.id).toBe('test');
      expect(event.payload).toEqual({ data: 'test' });
      expect(event.correlationId).toBe('corr-test');
      expect(event.eventId).toBeDefined();
      expect(event.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('getSubscriberCount / getActivePatterns', () => {
    it('tracks subscriber count per pattern', () => {
      const { bus } = createEventBus();
      bus.subscribe('evt.a', vi.fn());
      bus.subscribe('evt.a', vi.fn());
      bus.subscribe('evt.b', vi.fn());

      expect(bus.getSubscriberCount('evt.a')).toBe(2);
      expect(bus.getSubscriberCount('evt.b')).toBe(1);
      expect(bus.getSubscriberCount('evt.c')).toBe(0);
    });

    it('decrements count on unsubscribe', () => {
      const { bus } = createEventBus();
      const unsub = bus.subscribe('evt.a', vi.fn());
      expect(bus.getSubscriberCount('evt.a')).toBe(1);
      unsub();
      expect(bus.getSubscriberCount('evt.a')).toBe(0);
    });

    it('getActivePatterns lists patterns with active subscribers', () => {
      const { bus } = createEventBus();
      bus.subscribe('x', vi.fn());
      bus.subscribe('y', vi.fn());

      const patterns = bus.getActivePatterns();
      expect(patterns).toContain('x');
      expect(patterns).toContain('y');
    });

    it('removes pattern from getActivePatterns after all unsubscribed', () => {
      const { bus } = createEventBus();
      const u1 = bus.subscribe('z', vi.fn());
      const u2 = bus.subscribe('z', vi.fn());

      u1();
      u2();

      expect(bus.getActivePatterns()).not.toContain('z');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Backpressure (overflow) strategies — tested without SQLite for speed
// ─────────────────────────────────────────────────────────────────────────────

function makeMockStore(): ConstructorParameters<typeof EventBus>[0] {
  return {
    append: vi.fn().mockResolvedValue(undefined),
    getEvents: vi.fn().mockResolvedValue([]),
    getEventsAfter: vi.fn().mockResolvedValue([]),
    getEventById: vi.fn().mockResolvedValue(null),
  } as unknown as ConstructorParameters<typeof EventBus>[0];
}

function makeEvent(type: string): DomainEvent {
  return {
    eventId: `evt-${Math.random().toString(36).slice(2)}`,
    type,
    source: { kind: 'system', id: 'test' },
    timestamp: new Date(),
    payload: {},
    correlationId: 'corr-1',
  };
}

describe('EventBus backpressure — overflow: throw', () => {
  it('throws when maxListenersPerPattern is exceeded', () => {
    const bus = new EventBus(makeMockStore(), { maxListenersPerPattern: 2, overflow: 'throw' });
    bus.subscribe('test', vi.fn());
    bus.subscribe('test', vi.fn());

    expect(() => bus.subscribe('test', vi.fn())).toThrow(/Max listeners/);
  });

  it('does not throw when subscribing to a different pattern', () => {
    const bus = new EventBus(makeMockStore(), { maxListenersPerPattern: 1, overflow: 'throw' });
    bus.subscribe('pattern-a', vi.fn());

    expect(() => bus.subscribe('pattern-b', vi.fn())).not.toThrow();
  });
});

describe('EventBus backpressure — overflow: reject-new', () => {
  it('silently returns a no-op unsubscribe when at limit', () => {
    const bus = new EventBus(makeMockStore(), { maxListenersPerPattern: 1, overflow: 'reject-new' });
    bus.subscribe('test', vi.fn());

    const unsub = bus.subscribe('test', vi.fn());
    expect(typeof unsub).toBe('function');
    expect(bus.getSubscriberCount('test')).toBe(1);
  });

  it('rejected subscriber does not receive events', async () => {
    const bus = new EventBus(makeMockStore(), { maxListenersPerPattern: 1, overflow: 'reject-new' });

    const accepted = vi.fn();
    const rejected = vi.fn();

    bus.subscribe('test', accepted);
    bus.subscribe('test', rejected);

    await bus.publish(makeEvent('test'));
    await new Promise(r => setTimeout(r, 10));

    expect(accepted).toHaveBeenCalledOnce();
    expect(rejected).not.toHaveBeenCalled();
  });
});

describe('EventBus backpressure — overflow: drop-oldest', () => {
  it('evicts the oldest subscriber when at limit', async () => {
    const bus = new EventBus(makeMockStore(), { maxListenersPerPattern: 2, overflow: 'drop-oldest' });

    const first = vi.fn();
    const second = vi.fn();
    const third = vi.fn();

    bus.subscribe('test', first);
    bus.subscribe('test', second);
    bus.subscribe('test', third); // first gets evicted

    await bus.publish(makeEvent('test'));
    await new Promise(r => setTimeout(r, 10));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(third).toHaveBeenCalledOnce();
  });

  it('maintains count at maxListeners after eviction', () => {
    const bus = new EventBus(makeMockStore(), { maxListenersPerPattern: 2, overflow: 'drop-oldest' });
    bus.subscribe('test', vi.fn());
    bus.subscribe('test', vi.fn());
    bus.subscribe('test', vi.fn());

    expect(bus.getSubscriberCount('test')).toBe(2);
  });
});
