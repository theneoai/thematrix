/**
 * Provider Registry - 管理所有 LLM Provider 插件
 */

import type {
  ProviderPlugin,
  ProviderName,
  HealthStatus,
  IProviderRegistry,
} from '@thematrix/types';
import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'ProviderRegistry' });

export class ProviderRegistry implements IProviderRegistry {
  private plugins = new Map<ProviderName, ProviderPlugin>();

  register(plugin: ProviderPlugin): void {
    if (this.plugins.has(plugin.name)) {
      logger.warn(`Provider ${plugin.name} is being overridden`);
    }
    this.plugins.set(plugin.name, plugin);
    logger.info(`Provider registered: ${plugin.name} (${plugin.models.length} models)`);
  }

  get(provider: ProviderName): ProviderPlugin | undefined {
    return this.plugins.get(provider);
  }

  list(): ProviderPlugin[] {
    return Array.from(this.plugins.values());
  }

  getRegisteredNames(): ProviderName[] {
    return Array.from(this.plugins.keys());
  }

  async healthCheckAll(): Promise<HealthStatus[]> {
    const results = await Promise.allSettled(
      this.list().map(plugin => plugin.healthCheck())
    );

    return results.map((result, index) => {
      const plugin = this.list()[index];
      if (result.status === 'fulfilled') {
        return result.value;
      }
      return {
        provider: plugin.name,
        healthy: false,
        message: result.reason instanceof Error ? result.reason.message : String(result.reason),
        checkedAt: new Date(),
      };
    });
  }

  async healthCheck(provider: ProviderName): Promise<HealthStatus> {
    const plugin = this.plugins.get(provider);
    if (!plugin) {
      return {
        provider,
        healthy: false,
        message: `Provider not registered: ${provider}`,
        checkedAt: new Date(),
      };
    }
    try {
      return await plugin.healthCheck();
    } catch (error) {
      return {
        provider,
        healthy: false,
        message: error instanceof Error ? error.message : String(error),
        checkedAt: new Date(),
      };
    }
  }
}
