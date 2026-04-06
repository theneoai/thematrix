/**
 * Decision Trace - Structured agent reasoning observability
 *
 * Records a trace tree of agent decisions, tool calls, reflections,
 * and outcomes. Enables debugging, auditing, and systematic improvement
 * of agent behavior. Each trace captures the "why" behind agent actions.
 */
import { Logger, generateId } from '@thematrix/utils';

const logger = new Logger({ prefix: 'AgentTrace' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SpanType = 'turn' | 'tool-call' | 'llm-call' | 'reflection' | 'planning' | 'handoff' | 'guardrail';

export interface TraceSpan {
  id: string;
  name: string;
  type: SpanType;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  metadata?: Record<string, unknown>;
  result?: SpanResult;
  children: TraceSpan[];
  parentId?: string;
}

export interface SpanResult {
  status: 'success' | 'error' | 'skipped';
  output?: string;
  error?: string;
  tokensUsed?: number;
}

export interface Decision {
  id: string;
  spanId?: string;
  type: 'tool-selection' | 'plan-step' | 'retry' | 'terminate' | 'handoff' | 'rewrite';
  reasoning: string;
  alternatives?: string[];
  chosen: string;
  confidence?: number;
  timestamp: Date;
}

export interface TraceTree {
  agentId: string;
  workflowRunId: string;
  goal: string;
  rootSpans: TraceSpan[];
  decisions: Decision[];
  totalDurationMs: number;
  totalTokens: number;
  totalToolCalls: number;
  startTime: Date;
  endTime?: Date;
}

// ---------------------------------------------------------------------------
// AgentTrace
// ---------------------------------------------------------------------------

export class AgentTrace {
  private readonly agentId: string;
  private readonly workflowRunId: string;
  private readonly goal: string;
  private readonly startTime: Date;

  /** All root-level spans (no parent). */
  private readonly rootSpans: TraceSpan[] = [];

  /** Fast lookup for any span by id. */
  private readonly spanIndex = new Map<string, TraceSpan>();

  /** Stack of currently-open span ids – the top is the "current" parent. */
  private readonly spanStack: string[] = [];

  /** All recorded decisions. */
  private readonly decisions: Decision[] = [];

  constructor(agentId: string, workflowRunId: string, goal: string) {
    this.agentId = agentId;
    this.workflowRunId = workflowRunId;
    this.goal = goal;
    this.startTime = new Date();
    logger.info(`Trace started for agent=${agentId} workflow=${workflowRunId}`);
  }

  // -----------------------------------------------------------------------
  // Span lifecycle
  // -----------------------------------------------------------------------

  /**
   * Start a new span. If there is a currently-open span on the stack the new
   * span becomes its child; otherwise it is a root span.
   */
  startSpan(name: string, type: SpanType, metadata?: Record<string, unknown>): TraceSpan {
    const parentId = this.spanStack.length > 0
      ? this.spanStack[this.spanStack.length - 1]
      : undefined;

    const span: TraceSpan = {
      id: generateId(),
      name,
      type,
      startTime: new Date(),
      metadata,
      children: [],
      parentId,
    };

    this.spanIndex.set(span.id, span);

    if (parentId) {
      const parent = this.spanIndex.get(parentId);
      if (parent) {
        parent.children.push(span);
      }
    } else {
      this.rootSpans.push(span);
    }

    // Push onto the stack so subsequent spans nest inside this one.
    this.spanStack.push(span.id);

    logger.debug(`Span started: ${name} (${type}) id=${span.id} parent=${parentId ?? 'root'}`);
    return span;
  }

  /**
   * End an open span. The span is popped from the nesting stack and its
   * duration is computed.
   */
  endSpan(spanId: string, result: SpanResult): void {
    const span = this.spanIndex.get(spanId);
    if (!span) {
      logger.warn(`endSpan called for unknown span id=${spanId}`);
      return;
    }

    span.endTime = new Date();
    span.durationMs = span.endTime.getTime() - span.startTime.getTime();
    span.result = result;

    // Remove from the stack. Normally it is the top element, but we handle
    // out-of-order closes gracefully by scanning the stack.
    const idx = this.spanStack.lastIndexOf(spanId);
    if (idx !== -1) {
      this.spanStack.splice(idx, 1);
    }

    logger.debug(`Span ended: ${span.name} (${span.type}) status=${result.status} duration=${span.durationMs}ms`);
  }

  // -----------------------------------------------------------------------
  // Decisions
  // -----------------------------------------------------------------------

  /** Record a key decision point made by the agent. */
  addDecision(decision: Decision): void {
    this.decisions.push(decision);
    logger.debug(`Decision recorded: ${decision.type} – ${decision.chosen}`);
  }

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  /** Return the full trace tree. */
  getTrace(): TraceTree {
    const endTime = new Date();
    const totalDurationMs = endTime.getTime() - this.startTime.getTime();

    let totalTokens = 0;
    let totalToolCalls = 0;

    const walkSpans = (spans: TraceSpan[]): void => {
      for (const span of spans) {
        if (span.result?.tokensUsed) {
          totalTokens += span.result.tokensUsed;
        }
        if (span.type === 'tool-call') {
          totalToolCalls++;
        }
        walkSpans(span.children);
      }
    };

    walkSpans(this.rootSpans);

    return {
      agentId: this.agentId,
      workflowRunId: this.workflowRunId,
      goal: this.goal,
      rootSpans: this.rootSpans,
      decisions: this.decisions,
      totalDurationMs,
      totalTokens,
      totalToolCalls,
      startTime: this.startTime,
      endTime,
    };
  }

  /** Serializable JSON representation suitable for storage / transport. */
  toJSON(): object {
    return this.getTrace();
  }

  /** Human-readable summary of the trace. */
  getSummary(): string {
    const trace = this.getTrace();
    const lines: string[] = [
      `Trace for agent "${trace.agentId}" (workflow ${trace.workflowRunId})`,
      `Goal: ${trace.goal}`,
      `Duration: ${trace.totalDurationMs}ms | Tokens: ${trace.totalTokens} | Tool calls: ${trace.totalToolCalls}`,
      `Decisions: ${trace.decisions.length}`,
      '',
      'Spans:',
    ];

    const printSpan = (span: TraceSpan, depth: number): void => {
      const indent = '  '.repeat(depth);
      const status = span.result?.status ?? 'open';
      const duration = span.durationMs !== undefined ? ` (${span.durationMs}ms)` : '';
      lines.push(`${indent}- [${span.type}] ${span.name} => ${status}${duration}`);
      for (const child of span.children) {
        printSpan(child, depth + 1);
      }
    };

    for (const root of trace.rootSpans) {
      printSpan(root, 1);
    }

    if (trace.decisions.length > 0) {
      lines.push('');
      lines.push('Decisions:');
      for (const d of trace.decisions) {
        const conf = d.confidence !== undefined ? ` (confidence: ${d.confidence})` : '';
        lines.push(`  - [${d.type}] ${d.chosen}${conf} – ${d.reasoning}`);
      }
    }

    return lines.join('\n');
  }
}
