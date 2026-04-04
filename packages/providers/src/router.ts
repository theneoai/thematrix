/**
 * Provider Router - 模型路由、故障转移、负载均衡
 *
 * 借鉴 HermesAgent 的 unified provider router 和 OpenClaw 的 failover 模式
 */

import type {
  LLMAdapter,
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  ProviderConfig,
  ProviderRouterConfig,
  ProviderName,
  TokenConsumption,
} from '@thematrix/types';
import { Logger } from '@thematrix/utils';
import type { ProviderRegistry } from './registry.js';
import type { TokenPool } from './pool.js';
import type { SecretManager } from './secret.js';

const logger = new Logger({ prefix: 'ProviderRouter' });

/**
 * Token-tracked LLM adapter wrapper
 * 包装底层 adapter，自动记录 token 消耗到 TokenPool
 */
class TrackedAdapter implements LLMAdapter {
  readonly provider: string;

  constructor(
    private inner: LLMAdapter,
    private pool: TokenPool,
    private ownerId: string,
    private model: string,
  ) {
    this.provider = inner.provider;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await this.inner.chat(request);

    const consumption: TokenConsumption = {
      provider: this.provider as ProviderName,
      model: this.model,
      inputTokens: response.usage.promptTokens,
      outputTokens: response.usage.completionTokens,
    };

    try {
      await this.pool.consume(this.ownerId, consumption);
    } catch (error) {
      logger.warn(`Token consumption tracking failed for ${this.ownerId}:`, error);
    }

    return response;
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
    yield* this.inner.chatStream(request);
  }

  async countTokens(text: string): Promise<number> {
    return this.inner.countTokens(text);
  }
}

export class ProviderRouter {
  private registry: ProviderRegistry;
  private pool: TokenPool;
  private secretManager: SecretManager;
  private config: ProviderRouterConfig;
  private roundRobinIndex = 0;

  constructor(options: {
    registry: ProviderRegistry;
    pool: TokenPool;
    secretManager: SecretManager;
    config: ProviderRouterConfig;
  }) {
    this.registry = options.registry;
    this.pool = options.pool;
    this.secretManager = options.secretManager;
    this.config = options.config;
  }

  /**
   * 获取适配器（带 token 追踪和故障转移）
   */
  async getAdapter(
    preferredProvider: ProviderName,
    model: string,
    ownerId: string,
  ): Promise<LLMAdapter> {
    const providers = this.getProviderOrder(preferredProvider);

    for (const providerConfig of providers) {
      try {
        // 检查限流
        if (!this.pool.canRequest(providerConfig.provider)) {
          logger.warn(`Provider ${providerConfig.provider} is rate-limited, trying next`);
          continue;
        }

        const adapter = await this.createAdapter(providerConfig, model);
        return new TrackedAdapter(adapter, this.pool, ownerId, model);
      } catch (error) {
        logger.warn(`Failed to create adapter for ${providerConfig.provider}:`, error);
        if (!this.config.failover) {
          throw error;
        }
      }
    }

    throw new Error(`No available provider for model ${model}`);
  }

  private getProviderOrder(preferred: ProviderName): ProviderConfig[] {
    const configs = this.config.providers;

    switch (this.config.strategy) {
      case 'priority': {
        // preferred first, then rest in config order
        const preferredConfig = configs.find(c => c.provider === preferred);
        const rest = configs.filter(c => c.provider !== preferred);
        return preferredConfig ? [preferredConfig, ...rest] : configs;
      }

      case 'round-robin': {
        const index = this.roundRobinIndex % configs.length;
        this.roundRobinIndex++;
        return [...configs.slice(index), ...configs.slice(0, index)];
      }

      case 'least-cost':
      case 'least-latency':
      default:
        // 默认 priority 模式
        return configs;
    }
  }

  private async createAdapter(config: ProviderConfig, model: string): Promise<LLMAdapter> {
    const plugin = this.registry.get(config.provider);
    if (!plugin) {
      throw new Error(`Provider plugin not found: ${config.provider}`);
    }

    // 解析 API key
    const resolvedConfig = { ...config };
    if (config.apiKey && typeof config.apiKey === 'object') {
      resolvedConfig.apiKey = await this.secretManager.resolve(config.apiKey);
    }

    const auth = await plugin.prepareRuntimeAuth(resolvedConfig);
    return plugin.createAdapter(auth, model);
  }
}
