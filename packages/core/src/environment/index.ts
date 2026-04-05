/**
 * Environment Manager - 环境管理
 *
 * Resolves configuration overrides per deployment environment
 * (development, staging, production, or custom).
 */

import type {
  EnvironmentConfig,
  EnvironmentName,
  ProviderConfig,
} from '@thematrix/types';
import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'EnvironmentManager' });

export interface EnvironmentManagerOptions {
  /** Currently active environment */
  activeEnvironment: EnvironmentName;
  /** Environment configurations */
  environments: EnvironmentConfig[];
}

export class EnvironmentManager {
  private environments = new Map<EnvironmentName, EnvironmentConfig>();
  private active: EnvironmentName;

  constructor(options: EnvironmentManagerOptions) {
    for (const env of options.environments) {
      this.environments.set(env.name, env);
    }
    if (!this.environments.has(options.activeEnvironment)) {
      throw new Error(
        `Active environment "${options.activeEnvironment}" not found in configured environments: [${Array.from(this.environments.keys()).join(', ')}]`
      );
    }
    this.active = options.activeEnvironment;
    logger.info(`Active environment: ${this.active} (${this.environments.size} environments configured)`);
  }

  /** Get the currently active environment name */
  getActiveEnvironment(): EnvironmentName {
    return this.active;
  }

  /** Switch active environment at runtime */
  setActiveEnvironment(name: EnvironmentName): void {
    if (!this.environments.has(name)) {
      throw new Error(`Environment "${name}" is not configured`);
    }
    logger.info(`Switching environment: ${this.active} → ${name}`);
    this.active = name;
  }

  /** Get the active environment config */
  getActiveConfig(): EnvironmentConfig | undefined {
    return this.environments.get(this.active);
  }

  /** Resolve a provider config with environment overrides applied (shallow merge of override fields) */
  resolveProviderConfig(baseConfig: ProviderConfig): ProviderConfig {
    const envConfig = this.environments.get(this.active);
    if (!envConfig?.providers) return baseConfig;

    const override = envConfig.providers[baseConfig.provider];
    if (!override) return baseConfig;

    // Deep merge to preserve nested properties
    const result = { ...baseConfig };
    for (const [key, value] of Object.entries(override)) {
      if (value !== undefined) {
        (result as Record<string, unknown>)[key] = value;
      }
    }
    return result;
  }

  /** Resolve execution backend for current environment */
  resolveExecutionBackend(defaultBackend: string): { backend: string; config?: Record<string, unknown> } {
    const envConfig = this.environments.get(this.active);
    if (!envConfig?.execution) {
      return { backend: defaultBackend };
    }
    return {
      backend: envConfig.execution.backend,
      config: envConfig.execution.config,
    };
  }

  /** Get environment-specific variable */
  getVariable(key: string): string | undefined {
    const envConfig = this.environments.get(this.active);
    return envConfig?.variables?.[key];
  }

  /** Get all environment variables */
  getVariables(): Record<string, string> {
    const envConfig = this.environments.get(this.active);
    return { ...envConfig?.variables };
  }

  /** List all configured environments */
  listEnvironments(): EnvironmentConfig[] {
    return Array.from(this.environments.values());
  }

  /** Check if environment exists */
  hasEnvironment(name: EnvironmentName): boolean {
    return this.environments.has(name);
  }
}
