/**
 * Event 类型定义
 */

export interface DomainEvent<T = unknown> {
  eventId: string;
  type: string;
  source: {
    kind: 'agent' | 'workflow' | 'system';
    id: string;
  };
  timestamp: Date;
  payload: T;
  correlationId: string;
}

export type EventHandler<T = unknown> = (event: DomainEvent<T>) => void | Promise<void>;

export interface EventFilter {
  type?: string;
  sourceKind?: 'agent' | 'workflow' | 'system';
  sourceId?: string;
  correlationId?: string;
  fromTimestamp?: Date;
  toTimestamp?: Date;
}

export type Unsubscribe = () => void;

export interface IEventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe(pattern: string, handler: EventHandler): Unsubscribe;
  replay(fromEventId?: string, filter?: EventFilter): AsyncIterable<DomainEvent>;
}

export interface IEventStore {
  append(event: DomainEvent): Promise<void>;
  getEvents(filter?: EventFilter, limit?: number): Promise<DomainEvent[]>;
  getEventById(eventId: string): Promise<DomainEvent | undefined>;
  getEventsAfter(eventId: string, filter?: EventFilter): Promise<DomainEvent[]>;
}

// Predefined event types
export const EventTypes = {
  // Agent events
  AGENT_CREATED: 'agent.created',
  AGENT_INITIALIZED: 'agent.initialized',
  AGENT_STARTED: 'agent.started',
  AGENT_TURN_STARTED: 'agent.turn.started',
  AGENT_TURN_COMPLETED: 'agent.turn.completed',
  AGENT_PAUSED: 'agent.paused',
  AGENT_RESUMED: 'agent.resumed',
  AGENT_STOPPED: 'agent.stopped',
  AGENT_ERROR: 'agent.error',
  
  // Workflow events
  WORKFLOW_CREATED: 'workflow.created',
  WORKFLOW_STARTED: 'workflow.started',
  WORKFLOW_NODE_STARTED: 'workflow.node.started',
  WORKFLOW_NODE_COMPLETED: 'workflow.node.completed',
  WORKFLOW_NODE_FAILED: 'workflow.node.failed',
  WORKFLOW_PAUSED: 'workflow.paused',
  WORKFLOW_RESUMED: 'workflow.resumed',
  WORKFLOW_COMPLETED: 'workflow.completed',
  WORKFLOW_FAILED: 'workflow.failed',
  WORKFLOW_CANCELLED: 'workflow.cancelled',
  
  // System events
  SYSTEM_ERROR: 'system.error',
} as const;
