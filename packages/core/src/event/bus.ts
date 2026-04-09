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

export class EventBus implements IEventBus {
  private emitter = new EventEmitter();
  private store: IEventStore;
  private static readonly MAX_LISTENERS_PER_PATTERN = 50;
  private listenerCounts = new Map<string, number>();

  constructor(store: IEventStore) {
    this.store = store;
    this.emitter.setMaxListeners(100);
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
    if (currentCount >= EventBus.MAX_LISTENERS_PER_PATTERN) {
      throw new Error(
        `Max listeners (${EventBus.MAX_LISTENERS_PER_PATTERN}) reached for pattern "${pattern}". ` +
        `Subscription rejected to prevent memory leak.`,
      );
    }
    this.listenerCounts.set(pattern, currentCount + 1);

    this.emitter.on(pattern, wrappedHandler);
    logger.debug(`Subscribed to pattern: ${pattern}`);

    return () => {
      this.emitter.off(pattern, wrappedHandler);
      const count = this.listenerCounts.get(pattern) ?? 0;
      this.listenerCounts.set(pattern, Math.max(0, count - 1));
      logger.debug(`Unsubscribed from pattern: ${pattern}`);
    };
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
