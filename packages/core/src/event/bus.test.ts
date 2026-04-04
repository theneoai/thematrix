import { describe, it, expect, vi } from 'vitest';
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
});
