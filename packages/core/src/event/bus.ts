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

  constructor(store: IEventStore) {
    this.store = store;
    this.emitter.setMaxListeners(100);
  }

  async publish(event: DomainEvent): Promise<void> {
    // Persist first
    await this.store.append(event);
    
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

    this.emitter.on(pattern, wrappedHandler);
    logger.debug(`Subscribed to pattern: ${pattern}`);

    return () => {
      this.emitter.off(pattern, wrappedHandler);
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
