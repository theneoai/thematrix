/**
 * 指标收集和监控
 */

export interface MetricValue {
  name: string;
  value: number;
  labels: Record<string, string>;
  timestamp: Date;
}

export interface CounterMetric {
  type: 'counter';
  name: string;
  help: string;
  value: number;
  labels: Record<string, string>;
}

export interface GaugeMetric {
  type: 'gauge';
  name: string;
  help: string;
  value: number;
  labels: Record<string, string>;
}

export interface HistogramMetric {
  type: 'histogram';
  name: string;
  help: string;
  buckets: Record<string, number>;
  sum: number;
  count: number;
  labels: Record<string, string>;
}

export type Metric = CounterMetric | GaugeMetric | HistogramMetric;

export class MetricsCollector {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private histograms = new Map<string, { values: number[]; sum: number }>();
  private metricDefs = new Map<string, { type: string; help: string }>();

  /**
   * 注册计数器
   */
  registerCounter(name: string, help: string, labels: string[] = []): void {
    this.metricDefs.set(name, { type: 'counter', help });
  }

  /**
   * 注册仪表盘
   */
  registerGauge(name: string, help: string, labels: string[] = []): void {
    this.metricDefs.set(name, { type: 'gauge', help });
  }

  /**
   * 注册直方图
   */
  registerHistogram(name: string, help: string, buckets: number[] = [0.1, 0.5, 1, 2, 5, 10]): void {
    this.metricDefs.set(name, { type: 'histogram', help });
  }

  /**
   * 增加计数器
   */
  inc(name: string, labels: Record<string, string> = {}, value: number = 1): void {
    const key = this.getKey(name, labels);
    const current = this.counters.get(key) ?? 0;
    this.counters.set(key, current + value);
  }

  /**
   * 设置仪表盘值
   */
  set(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.getKey(name, labels);
    this.gauges.set(key, value);
  }

  /**
   * 记录直方图值
   */
  observe(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.getKey(name, labels);
    const current = this.histograms.get(key) ?? { values: [], sum: 0 };
    current.values.push(value);
    current.sum += value;
    this.histograms.set(key, current);
  }

  /**
   * 获取所有指标
   */
  getMetrics(): string {
    const lines: string[] = [];

    // 计数器
    for (const [key, value] of this.counters) {
      const { name, labels } = this.parseKey(key);
      const def = this.metricDefs.get(name);
      if (def) {
        lines.push(`# HELP ${name} ${def.help}`);
        lines.push(`# TYPE ${name} counter`);
        lines.push(`${name}${this.formatLabels(labels)} ${value}`);
      }
    }

    // 仪表盘
    for (const [key, value] of this.gauges) {
      const { name, labels } = this.parseKey(key);
      const def = this.metricDefs.get(name);
      if (def) {
        lines.push(`# HELP ${name} ${def.help}`);
        lines.push(`# TYPE ${name} gauge`);
        lines.push(`${name}${this.formatLabels(labels)} ${value}`);
      }
    }

    // 直方图
    for (const [key, data] of this.histograms) {
      const { name, labels } = this.parseKey(key);
      const def = this.metricDefs.get(name);
      if (def && data.values.length > 0) {
        lines.push(`# HELP ${name} ${def.help}`);
        lines.push(`# TYPE ${name} histogram`);
        
        // 计算桶
        const buckets = [0.1, 0.5, 1, 2, 5, 10];
        for (const bucket of buckets) {
          const count = data.values.filter(v => v <= bucket).length;
          lines.push(`${name}_bucket${this.formatLabels({ ...labels, le: String(bucket) })} ${count}`);
        }
        lines.push(`${name}_bucket${this.formatLabels({ ...labels, le: '+Inf' })} ${data.values.length}`);
        lines.push(`${name}_sum${this.formatLabels(labels)} ${data.sum}`);
        lines.push(`${name}_count${this.formatLabels(labels)} ${data.values.length}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 清除所有指标
   */
  clear(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }

  private getKey(name: string, labels: Record<string, string>): string {
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return labelStr ? `${name}{${labelStr}}` : name;
  }

  private parseKey(key: string): { name: string; labels: Record<string, string> } {
    const match = key.match(/^([^{]+)(?:\{([^}]*)\})?$/);
    if (!match) return { name: key, labels: {} };
    
    const name = match[1];
    const labelStr = match[2];
    
    if (!labelStr) return { name, labels: {} };
    
    const labels: Record<string, string> = {};
    for (const pair of labelStr.split(',')) {
      const [k, v] = pair.split('=');
      if (k && v) labels[k] = v;
    }
    
    return { name, labels };
  }

  private formatLabels(labels: Record<string, string>): string {
    const entries = Object.entries(labels);
    if (entries.length === 0) return '';
    
    const labelStr = entries
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return `{${labelStr}}`;
  }
}

/**
 * 预定义的指标名称
 */
export const Metrics = {
  // 工作流指标
  WORKFLOW_RUNS_TOTAL: 'thematrix_workflow_runs_total',
  WORKFLOW_RUNS_ACTIVE: 'thematrix_workflow_runs_active',
  WORKFLOW_RUN_DURATION: 'thematrix_workflow_run_duration_seconds',
  WORKFLOW_NODE_DURATION: 'thematrix_workflow_node_duration_seconds',
  
  // Agent 指标
  AGENT_RUNS_TOTAL: 'thematrix_agent_runs_total',
  AGENT_RUN_DURATION: 'thematrix_agent_run_duration_seconds',
  AGENT_TOKENS_USED: 'thematrix_agent_tokens_used_total',
  AGENT_ERRORS_TOTAL: 'thematrix_agent_errors_total',
  
  // LLM 指标
  LLM_REQUESTS_TOTAL: 'thematrix_llm_requests_total',
  LLM_REQUEST_DURATION: 'thematrix_llm_request_duration_seconds',
  LLM_TOKENS_INPUT: 'thematrix_llm_tokens_input_total',
  LLM_TOKENS_OUTPUT: 'thematrix_llm_tokens_output_total',
  
  // 系统指标
  EVENTS_PUBLISHED: 'thematrix_events_published_total',
  MEMORY_OPERATIONS: 'thematrix_memory_operations_total',
} as const;

/**
 * 创建全局指标收集器
 */
export const metrics = new MetricsCollector();

// 注册默认指标
metrics.registerCounter(Metrics.WORKFLOW_RUNS_TOTAL, 'Total number of workflow runs');
metrics.registerGauge(Metrics.WORKFLOW_RUNS_ACTIVE, 'Number of currently active workflow runs');
metrics.registerHistogram(Metrics.WORKFLOW_RUN_DURATION, 'Workflow run duration in seconds');
metrics.registerHistogram(Metrics.WORKFLOW_NODE_DURATION, 'Workflow node execution duration in seconds');
metrics.registerCounter(Metrics.AGENT_RUNS_TOTAL, 'Total number of agent runs');
metrics.registerHistogram(Metrics.AGENT_RUN_DURATION, 'Agent run duration in seconds');
metrics.registerCounter(Metrics.AGENT_TOKENS_USED, 'Total number of tokens used by agents');
metrics.registerCounter(Metrics.AGENT_ERRORS_TOTAL, 'Total number of agent errors');
metrics.registerCounter(Metrics.LLM_REQUESTS_TOTAL, 'Total number of LLM requests');
metrics.registerHistogram(Metrics.LLM_REQUEST_DURATION, 'LLM request duration in seconds');
metrics.registerCounter(Metrics.LLM_TOKENS_INPUT, 'Total number of input tokens');
metrics.registerCounter(Metrics.LLM_TOKENS_OUTPUT, 'Total number of output tokens');
