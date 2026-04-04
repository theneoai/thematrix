/**
 * TheMatrix Runtime - 生产级运行时入口
 */
import type { WorkflowDefinition, AgentDefinition, LLMAdapter } from '@thematrix/types';
import {
  EventBus,
  SQLiteEventStore,
  MemoryManager,
  AgentRegistry,
  WorkflowEngine,
  HealthMonitor,
  createDefaultHealthChecks,
  metrics,
  Metrics,
  type WorkflowError,
} from '../index.js';
import { Logger } from '@thematrix/utils';
import { MockLLMAdapter, AnthropicAdapter, OpenAIAdapter, KimiAdapter, OpenCodeAdapter, MiniMaxAdapter } from '@thematrix/adapters';

const logger = new Logger({ prefix: 'Runtime' });

export interface LLMProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  /** MiniMax 旧版账户鉴权 GroupId（新版 API Key 无需设置） */
  groupId?: string;
}

export interface RuntimeOptions {
  /**
   * 数据库路径
   */
  dbPath?: string;
  /**
   * 全局超时时间（毫秒）
   */
  globalTimeoutMs?: number;
  /**
   * 最大并发工作流数
   */
  maxConcurrentWorkflows?: number;
  /**
   * 版本号
   */
  version?: string;
  /**
   * LLM 提供商配置 (provider name → config)
   */
  llmProviders?: Record<string, LLMProviderConfig>;
}

export interface RuntimeStatus {
  status: 'running' | 'stopped' | 'error';
  version: string;
  uptimeSeconds: number;
  activeWorkflows: number;
  totalWorkflows: number;
}

export class Runtime {
  private eventBus: EventBus;
  private memory: MemoryManager;
  private agentRegistry: AgentRegistry;
  private workflowEngine: WorkflowEngine;
  private healthMonitor: HealthMonitor;
  private startTime: Date;
  private version: string;
  private _status: RuntimeStatus['status'] = 'stopped';
  private agentIdMap = new Map<string, string>();

  constructor(options: RuntimeOptions = {}) {
    this.version = options.version ?? '0.1.0';
    this.startTime = new Date();
    
    const eventStore = new SQLiteEventStore(options.dbPath ?? ':memory:');
    this.eventBus = new EventBus(eventStore);
    this.memory = new MemoryManager({ dbPath: options.dbPath ?? ':memory:' });
    this.agentRegistry = new AgentRegistry();
    
    const llmProviders = options.llmProviders ?? {};

    this.workflowEngine = new WorkflowEngine({
      eventBus: this.eventBus,
      memory: this.memory,
      agentRegistry: this.agentRegistry,
      llmAdapterFactory: ({ provider, model }): LLMAdapter => {
        const cfg = llmProviders[provider];
        if (provider === 'anthropic' && cfg?.apiKey) {
          return new AnthropicAdapter({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, defaultModel: model });
        }
        if (provider === 'openai' && cfg?.apiKey) {
          return new OpenAIAdapter({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, defaultModel: model });
        }
        if (provider === 'kimicode' && cfg?.apiKey) {
          return new KimiAdapter({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, defaultModel: model });
        }
        if (provider === 'opencode' && cfg?.apiKey && cfg?.baseUrl) {
          return new OpenCodeAdapter({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, defaultModel: model });
        }
        if (provider === 'minimax' && cfg?.apiKey) {
          return new MiniMaxAdapter({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, defaultModel: model, groupId: cfg.groupId });
        }
        // Fallback to mock when no API key configured
        return new MockLLMAdapter();
      },
      agentIdMap: this.agentIdMap,
      globalTimeoutMs: options.globalTimeoutMs,
      maxConcurrentWorkflows: options.maxConcurrentWorkflows,
    });

    this.healthMonitor = new HealthMonitor(this.version);
    
    // 注册默认健康检查
    const healthChecks = createDefaultHealthChecks(this.memory, { dbPath: options.dbPath });
    for (const check of healthChecks) {
      this.healthMonitor.register(check);
    }
  }

  /**
   * 启动运行时
   */
  async start(): Promise<void> {
    logger.info(`Starting TheMatrix Runtime v${this.version}`);
    this._status = 'running';
    
    // 运行初始健康检查
    const health = await this.healthMonitor.runAllChecks();
    if (health.status === 'unhealthy') {
      logger.error('Initial health check failed:', health.checks);
      throw new Error('System is unhealthy');
    }
    
    logger.info('Runtime started successfully');
  }

  /**
   * 停止运行时
   */
  async stop(): Promise<void> {
    logger.info('Stopping TheMatrix Runtime');
    this._status = 'stopped';
    
    // 取消所有运行中的工作流
    const runs = this.workflowEngine.getRuns();
    for (const run of runs) {
      if (run.status === 'running') {
        await this.workflowEngine.cancelWorkflow(run.runId);
      }
    }
    
    this.healthMonitor.dispose();
    this.memory.close();
    
    logger.info('Runtime stopped');
  }

  /**
   * 注册 Agent
   */
  registerAgent(definition: AgentDefinition, aliases?: string[]): void {
    this.agentRegistry.register(definition);
    if (aliases) {
      // 将别名映射到 agent ID
      for (const alias of aliases) {
        this.agentIdMap.set(alias, definition.id);
      }
    }
    
    metrics.inc(Metrics.AGENT_RUNS_TOTAL, { 
      agent_id: definition.id,
      operation: 'register' 
    });
  }

  /**
   * 运行工作流
   */
  async runWorkflow(
    definition: WorkflowDefinition, 
    input: Record<string, unknown>
  ) {
    if (this._status !== 'running') {
      throw new Error('Runtime is not running');
    }

    // 注册 agent 别名映射到共享的 agentIdMap
    for (const [name, ref] of Object.entries(definition.agents)) {
      // 简化：假设 ref.ref 是 agent ID 或文件路径
      const agentId = ref.ref.replace('./', '').replace('.agent.yaml', '');
      this.agentIdMap.set(name, agentId);
      this.agentIdMap.set(ref.ref, agentId);
    }

    const run = await this.workflowEngine.startWorkflow(definition, input);
    
    logger.info(`Workflow ${definition.id} started with run ID: ${run.runId}`);
    
    return run;
  }

  /**
   * 获取工作流运行状态
   */
  getWorkflowRun(runId: string) {
    return this.workflowEngine.getRun(runId);
  }

  /**
   * 获取所有工作流运行
   */
  getAllRuns() {
    return this.workflowEngine.getRuns();
  }

  /**
   * 暂停工作流
   */
  async pauseWorkflow(runId: string): Promise<void> {
    await this.workflowEngine.pauseWorkflow(runId);
  }

  /**
   * 恢复工作流
   */
  async resumeWorkflow(runId: string): Promise<void> {
    await this.workflowEngine.resumeWorkflow(runId);
  }

  /**
   * 取消工作流
   */
  async cancelWorkflow(runId: string): Promise<void> {
    await this.workflowEngine.cancelWorkflow(runId);
  }

  /**
   * 获取运行时状态
   */
  getStatus(): RuntimeStatus {
    const runs = this.workflowEngine.getRuns();
    return {
      status: this._status,
      version: this.version,
      uptimeSeconds: Math.floor((Date.now() - this.startTime.getTime()) / 1000),
      activeWorkflows: runs.filter(r => r.status === 'running').length,
      totalWorkflows: runs.length,
    };
  }

  /**
   * 获取健康状态
   */
  async getHealth() {
    return this.healthMonitor.runAllChecks();
  }

  /**
   * 获取指标
   */
  getMetrics(): string {
    return metrics.getMetrics();
  }

  /**
   * 订阅事件
   */
  subscribeToEvents(pattern: string, handler: (event: unknown) => void) {
    return this.eventBus.subscribe(pattern, handler);
  }
}
