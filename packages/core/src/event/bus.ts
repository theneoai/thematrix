/**
 * Event Bus - 事件总线实现
 */
import type { 
  DomainEvent, 
  EventHandler, 
  EventFilter, 
  IEventBus, 
  IEventStore,
  Unsubscribe 
} from '@thematrix/types';
import { Logger, generateEventId } from '@thematrix/utils';
import { EventEmitter } from 'events';

const logger = new Logger({ prefix: 'EventBus' });

export type EventBusOverflowBehavior = 'throw' | 'drop-oldest' | 'reject-new';

export interface EventBusOptions {
  /**
   * Maximum number of subscribers per event pattern.
   * Default: 50.
   */
  maxListenersPerPattern?: number;
  /**
   * Behavior when the subscriber limit is reached:
   * - 'throw': throw an error (default, safest — makes the leak visible)
   * - 'drop-oldest': silently remove the oldest subscriber to make room
   * - 'reject-new': silently discard the new subscription and return a no-op unsubscribe
   */
  overflow?: EventBusOverflowBehavior;
}

export class EventBus implements IEventBus {
  private emitter = new EventEmitter();
  private store: IEventStore;
  private readonly maxListenersPerPattern: number;
  private readonly overflow: EventBusOverflowBehavior;
  private listenerCounts = new Map<string, number>();
  /** Tracks raw emitter listeners per pattern for drop-oldest support */
  private patternListeners = new Map<string, Array<(event: DomainEvent) => void>>();

  constructor(store: IEventStore, options?: EventBusOptions) {
    this.store = store;
    this.maxListenersPerPattern = options?.maxListenersPerPattern ?? 50;
    this.overflow = options?.overflow ?? 'throw';
    this.emitter.setMaxListeners(this.maxListenersPerPattern * 10);
  }

  async publish(event: DomainEvent): Promise<void> {
    // Persist first — surface failures so callers know the event was not durably stored
    try {
      await this.store.append(event);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to persist event ${event.type} (${event.eventId}): ${message}`);
      throw new Error(`Event store append failed for ${event.type}: ${message}`);
    }

    // Then broadcast
    this.emitter.emit(event.type, event);
    this.emitter.emit('*', event);

    logger.debug(`Published event: ${event.type} (${event.eventId})`);
  }

  subscribe(pattern: string, handler: EventHandler): Unsubscribe {
    const wrappedHandler = (event: DomainEvent) => {
      try {
        const result = handler(event);
        // Catch rejected promises from async handlers
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch((error) => {
            logger.error(`Async error in event handler for ${pattern}:`, error);
          });
        }
      } catch (error) {
        logger.error(`Error in event handler for ${pattern}:`, error);
      }
    };

    // Guard against listener accumulation per pattern
    const currentCount = this.listenerCounts.get(pattern) ?? 0;
    if (currentCount >= this.maxListenersPerPattern) {
      switch (this.overflow) {
        case 'throw':
          throw new Error(
            `Max listeners (${this.maxListenersPerPattern}) reached for pattern "${pattern}". ` +
            `Subscription rejected to prevent memory leak. Use overflow: 'drop-oldest' or 'reject-new' to change this behavior.`,
          );

        case 'reject-new':
          logger.warn(
            `Max listeners (${this.maxListenersPerPattern}) reached for pattern "${pattern}". ` +
            `New subscription silently rejected (overflow=reject-new).`,
          );
          return () => { /* no-op */ };

        case 'drop-oldest': {
          const listeners = this.patternListeners.get(pattern) ?? [];
          if (listeners.length > 0) {
            const oldest = listeners.shift()!;
            this.emitter.off(pattern, oldest);
            this.listenerCounts.set(pattern, Math.max(0, (this.listenerCounts.get(pattern) ?? 0) - 1));
            logger.warn(
              `Max listeners (${this.maxListenersPerPattern}) reached for pattern "${pattern}". ` +
              `Oldest subscriber evicted (overflow=drop-oldest).`,
            );
          }
          break;
        }
      }
    }

    // Track raw listener for drop-oldest eviction support
    const listeners = this.patternListeners.get(pattern) ?? [];
    listeners.push(wrappedHandler);
    this.patternListeners.set(pattern, listeners);

    this.listenerCounts.set(pattern, (this.listenerCounts.get(pattern) ?? 0) + 1);
    this.emitter.on(pattern, wrappedHandler);
    logger.debug(`Subscribed to pattern: ${pattern}`);

    return () => {
      this.emitter.off(pattern, wrappedHandler);
      // Remove from raw listener tracking
      const ls = this.patternListeners.get(pattern);
      if (ls) {
        const idx = ls.indexOf(wrappedHandler);
        if (idx !== -1) ls.splice(idx, 1);
        if (ls.length === 0) this.patternListeners.delete(pattern);
      }
      const count = this.listenerCounts.get(pattern) ?? 0;
      const newCount = Math.max(0, count - 1);
      if (newCount === 0) {
        this.listenerCounts.delete(pattern);
      } else {
        this.listenerCounts.set(pattern, newCount);
      }
      logger.debug(`Unsubscribed from pattern: ${pattern}`);
    };
  }

  /**
   * Return the current subscriber count for a pattern.
   * Useful for monitoring and leak detection.
   */
  getSubscriberCount(pattern: string): number {
    return this.listenerCounts.get(pattern) ?? 0;
  }

  /**
   * Return all patterns that currently have active subscribers.
   */
  getActivePatterns(): string[] {
    return Array.from(this.listenerCounts.keys());
  }

  async *replay(fromEventId?: string, filter?: EventFilter): AsyncIterable<DomainEvent> {
    let events: DomainEvent[];
    
    if (fromEventId) {
      events = await this.store.getEventsAfter(fromEventId, filter);
    } else {
      events = await this.store.getEvents(filter);
    }

    for (const event of events) {
      yield event;
    }
  }

  createEvent<T>(
    type: string,
    source: { kind: 'agent' | 'workflow' | 'system'; id: string },
    payload: T,
    correlationId: string
  ): DomainEvent<T> {
    return {
      eventId: generateEventId(),
      type,
      source,
      timestamp: new Date(),
      payload,
      correlationId,
    };
  }
}
