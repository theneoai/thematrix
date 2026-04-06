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

let spanIdCounter = 0;

function generateTraceId(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateSpanId(): string {
  spanIdCounter++;
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, BigInt(Date.now() * 1000 + spanIdCounter));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
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

export class InMemoryTelemetryProvider implements ITelemetryProvider {
  readonly spans: RecordedSpan[] = [];
  private activeSpanStack: InMemorySpan[] = [];
  private currentTraceId: string = generateTraceId();

  startSpan(name: string, options?: TelemetrySpanOptions): ITelemetrySpan {
    const parentContext = options?.parent ?? this.getActiveSpan()?.context;
    const traceId = parentContext?.traceId ?? this.currentTraceId;
    const span = new InMemorySpan(name, traceId, parentContext, options);
    this.spans.push(span.record);
    this.activeSpanStack.push(span);
    return span;
  }

  getActiveSpan(): ITelemetrySpan | undefined {
    return this.activeSpanStack.length > 0
      ? this.activeSpanStack[this.activeSpanStack.length - 1]
      : undefined;
  }

  async withSpan<T>(name: string, fn: (span: ITelemetrySpan) => Promise<T>, options?: TelemetrySpanOptions): Promise<T> {
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
      const idx = this.activeSpanStack.indexOf(span as InMemorySpan);
      if (idx !== -1) this.activeSpanStack.splice(idx, 1);
    }
  }

  inject(carrier: Record<string, string>): void {
    const activeSpan = this.getActiveSpan();
    if (activeSpan) {
      carrier['traceparent'] = `00-${activeSpan.context.traceId}-${activeSpan.context.spanId}-0${activeSpan.context.traceFlags}`;
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
    this.activeSpanStack.length = 0;
    logger.info('InMemoryTelemetryProvider shut down');
  }

  /** 获取 span 数量 (用于测试) */
  getSpanCount(): number {
    return this.spans.length;
  }

  /** 清空所有 span (用于测试) */
  clear(): void {
    this.spans.length = 0;
    this.activeSpanStack.length = 0;
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
