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

  // Trigger events (gateway → scheduler)
  TRIGGER_RECEIVED: 'trigger.received',
  TRIGGER_MATCHED: 'trigger.matched',
  TRIGGER_FIRED: 'trigger.fired',
  SCHEDULE_FIRED: 'schedule.fired',

  // Token pool events
  TOKEN_CONSUMED: 'token.consumed',
  TOKEN_BUDGET_WARNING: 'token.budget.warning',
  TOKEN_BUDGET_EXCEEDED: 'token.budget.exceeded',

  // Cluster events
  CLUSTER_NODE_REGISTERED: 'cluster.node.registered',
  CLUSTER_NODE_DEREGISTERED: 'cluster.node.deregistered',
  CLUSTER_NODE_OFFLINE: 'cluster.node.offline',
  CLUSTER_TASK_DISTRIBUTED: 'cluster.task.distributed',

  // Executor events
  EXECUTION_STARTED: 'execution.started',
  EXECUTION_COMPLETED: 'execution.completed',
  EXECUTION_FAILED: 'execution.failed',

  // Alert events
  ALERT_FIRED: 'alert.fired',
  ALERT_RESOLVED: 'alert.resolved',
  ALERT_ACKNOWLEDGED: 'alert.acknowledged',

  // Agent loop events
  AGENT_PLAN_CREATED: 'agent.plan.created',
  AGENT_PLAN_STEP_STARTED: 'agent.plan.step.started',
  AGENT_PLAN_STEP_COMPLETED: 'agent.plan.step.completed',
  AGENT_PLAN_REVISED: 'agent.plan.revised',
  AGENT_REFLECTION: 'agent.reflection',
  AGENT_LOOP_ITERATION: 'agent.loop.iteration',
  AGENT_LOOP_COMPLETED: 'agent.loop.completed',

  // Handoff events
  AGENT_HANDOFF_REQUESTED: 'agent.handoff.requested',
  AGENT_HANDOFF_ACCEPTED: 'agent.handoff.accepted',
  AGENT_HANDOFF_REJECTED: 'agent.handoff.rejected',

  // Guardrail events
  GUARDRAIL_TRIGGERED: 'guardrail.triggered',
  GUARDRAIL_BLOCKED: 'guardrail.blocked',
  GUARDRAIL_REWRITTEN: 'guardrail.rewritten',

  // Approval events
  APPROVAL_REQUESTED: 'approval.requested',
  APPROVAL_APPROVED: 'approval.approved',
  APPROVAL_REJECTED: 'approval.rejected',
  APPROVAL_TIMED_OUT: 'approval.timed_out',

  // Policy events
  POLICY_EVALUATED: 'policy.evaluated',
  POLICY_VIOLATED: 'policy.violated',

  // Eval events
  EVAL_STARTED: 'eval.started',
  EVAL_COMPLETED: 'eval.completed',

  // A2A protocol events
  A2A_TASK_RECEIVED: 'a2a.task.received',
  A2A_TASK_SENT: 'a2a.task.sent',
  A2A_TASK_COMPLETED: 'a2a.task.completed',
  A2A_TASK_FAILED: 'a2a.task.failed',
  A2A_AGENT_DISCOVERED: 'a2a.agent.discovered',

  // Telemetry events
  TELEMETRY_SPAN_EXPORTED: 'telemetry.span.exported',

  // Cognitive memory events
  MEMORY_EPISODE_RECORDED: 'memory.episode.recorded',
  MEMORY_CONSOLIDATED: 'memory.consolidated',
  MEMORY_DECAYED: 'memory.decayed',
} as const;
