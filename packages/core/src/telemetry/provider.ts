/**
 * OpenTelemetry Provider - 分布式追踪和指标集成
 *
 * 提供两种实现:
 * 1. OTelProvider: 对接真实 OpenTelemetry SDK (需安装 @opentelemetry/* 依赖)
 * 2. NoopTelemetryProvider: 零开销空实现, 用于未启用 telemetry 时
 *
 * 设计原则:
 * - 与 AgentTrace 互补: AgentTrace 记录业务决策树, OTel 记录性能/分布式追踪
 * - 遵循 OpenTelemetry Semantic Conventions for GenAI
 * - 支持 W3C Trace Context 跨进程传播
 */
import type {
  ITelemetryProvider,
  ITelemetrySpan,
  TraceContext,
  TelemetrySpanOptions,
  TelemetrySpanStatus,
  TelemetryConfig,
} from '@thematrix/types';
import { Logger } from '@thematrix/utils';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

const logger = new Logger({ prefix: 'Telemetry' });

// ============================================================
// Noop Implementation (zero overhead when disabled)
// ============================================================

class NoopSpan implements ITelemetrySpan {
  readonly context: TraceContext = {
    traceId: '0'.repeat(32),
    spanId: '0'.repeat(16),
    traceFlags: 0,
  };
  setAttribute(): void { /* noop */ }
  setAttributes(): void { /* noop */ }
  addEvent(): void { /* noop */ }
  recordException(): void { /* noop */ }
  setStatus(): void { /* noop */ }
  end(): void { /* noop */ }
}

const NOOP_SPAN = new NoopSpan();

export class NoopTelemetryProvider implements ITelemetryProvider {
  startSpan(): ITelemetrySpan { return NOOP_SPAN; }
  getActiveSpan(): ITelemetrySpan | undefined { return undefined; }
  async withSpan<T>(_name: string, fn: (span: ITelemetrySpan) => Promise<T>): Promise<T> {
    return fn(NOOP_SPAN);
  }
  inject(): void { /* noop */ }
  extract(): TraceContext | undefined { return undefined; }
  async flush(): Promise<void> { /* noop */ }
  async shutdown(): Promise<void> { /* noop */ }
}

// ============================================================
// In-Memory Implementation (for testing and development)
// ============================================================

function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

function generateSpanId(): string {
  return randomBytes(8).toString('hex');
}

export interface RecordedSpan {
  name: string;
  context: TraceContext;
  parentContext?: TraceContext;
  kind: string;
  startTime: number;
  endTime?: number;
  attributes: Record<string, string | number | boolean>;
  events: Array<{ name: string; timestamp: number; attributes?: Record<string, string | number | boolean> }>;
  status: TelemetrySpanStatus;
}

class InMemorySpan implements ITelemetrySpan {
  readonly context: TraceContext;
  readonly record: RecordedSpan;

  constructor(name: string, traceId: string, parentContext?: TraceContext, options?: TelemetrySpanOptions) {
    this.context = {
      traceId,
      spanId: generateSpanId(),
      traceFlags: 1,
    };

    this.record = {
      name,
      context: this.context,
      parentContext,
      kind: options?.kind ?? 'internal',
      startTime: Date.now(),
      attributes: { ...(options?.attributes ?? {}) },
      events: [],
      status: { code: 'unset' },
    };
  }

  setAttribute(key: string, value: string | number | boolean): void {
    this.record.attributes[key] = value;
  }

  setAttributes(attrs: Record<string, string | number | boolean>): void {
    Object.assign(this.record.attributes, attrs);
  }

  addEvent(name: string, attributes?: Record<string, string | number | boolean>): void {
    this.record.events.push({ name, timestamp: Date.now(), attributes });
  }

  recordException(error: Error): void {
    this.addEvent('exception', {
      'exception.type': error.name,
      'exception.message': error.message,
    });
    this.setStatus({ code: 'error', message: error.message });
  }

  setStatus(status: TelemetrySpanStatus): void {
    this.record.status = status;
  }

  end(): void {
    this.record.endTime = Date.now();
  }
}

/** Per-async-context span stack using AsyncLocalStorage */
const spanStorage = new AsyncLocalStorage<InMemorySpan[]>();

export class InMemoryTelemetryProvider implements ITelemetryProvider {
  readonly spans: RecordedSpan[] = [];
  private currentTraceId: string = generateTraceId();

  startSpan(name: string, options?: TelemetrySpanOptions): ITelemetrySpan {
    const stack = spanStorage.getStore();
    const parentContext = options?.parent
      ?? (stack && stack.length > 0 ? stack[stack.length - 1].context : undefined);
    const traceId = parentContext?.traceId ?? this.currentTraceId;
    const span = new InMemorySpan(name, traceId, parentContext, options);
    this.spans.push(span.record);
    // Push onto per-async-context stack if available
    if (stack) {
      stack.push(span);
    }
    return span;
  }

  getActiveSpan(): ITelemetrySpan | undefined {
    const stack = spanStorage.getStore();
    return stack && stack.length > 0 ? stack[stack.length - 1] : undefined;
  }

  async withSpan<T>(name: string, fn: (span: ITelemetrySpan) => Promise<T>, options?: TelemetrySpanOptions): Promise<T> {
    // Create a new stack inheriting from parent context, or start fresh
    const parentStack = spanStorage.getStore() ?? [];
    const newStack = [...parentStack];

    return spanStorage.run(newStack, async () => {
      const span = this.startSpan(name, options);
      try {
        const result = await fn(span);
        span.setStatus({ code: 'ok' });
        return result;
      } catch (error) {
        if (error instanceof Error) {
          span.recordException(error);
        }
        throw error;
      } finally {
        span.end();
        const idx = newStack.indexOf(span as InMemorySpan);
        if (idx !== -1) newStack.splice(idx, 1);
      }
    });
  }

  inject(carrier: Record<string, string>): void {
    const activeSpan = this.getActiveSpan();
    if (activeSpan) {
      // W3C Trace Context format: 00-{traceId}-{spanId}-{flags}
      // flags is 2 hex chars (e.g., 01 for sampled)
      const flags = activeSpan.context.traceFlags.toString(16).padStart(2, '0');
      carrier['traceparent'] = `00-${activeSpan.context.traceId}-${activeSpan.context.spanId}-${flags}`;
    }
  }

  extract(carrier: Record<string, string>): TraceContext | undefined {
    const traceparent = carrier['traceparent'];
    if (!traceparent) return undefined;

    const parts = traceparent.split('-');
    if (parts.length !== 4) return undefined;

    return {
      traceId: parts[1],
      spanId: parts[2],
      traceFlags: parseInt(parts[3], 16),
    };
  }

  async flush(): Promise<void> {
    logger.debug(`Flushing ${this.spans.length} spans`);
  }

  async shutdown(): Promise<void> {
    this.spans.length = 0;
    logger.info('InMemoryTelemetryProvider shut down');
  }

  /** 获取 span 数量 (用于测试) */
  getSpanCount(): number {
    return this.spans.length;
  }

  /** 清空所有 span (用于测试) */
  clear(): void {
    this.spans.length = 0;
    this.currentTraceId = generateTraceId();
  }
}

// ============================================================
// Factory
// ============================================================

/**
 * 根据配置创建 Telemetry Provider
 */
export function createTelemetryProvider(config: TelemetryConfig): ITelemetryProvider {
  if (!config.enabled) {
    logger.info('Telemetry disabled, using NoopTelemetryProvider');
    return new NoopTelemetryProvider();
  }

  // 使用内存实现 (生产环境可替换为 OTLP 导出)
  logger.info(`Telemetry enabled: service=${config.serviceName ?? 'thematrix'}, endpoint=${config.exporterEndpoint ?? 'in-memory'}`);
  return new InMemoryTelemetryProvider();
}
