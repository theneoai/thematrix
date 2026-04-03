/**
 * 配置管理 - 生产环境配置
 */
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'yaml';
import { z } from 'zod';

/**
 * 运行时配置 Schema
 */
export const runtimeConfigSchema = z.object({
  /**
   * 环境
   */
  env: z.enum(['development', 'staging', 'production']).default('development'),
  
  /**
   * 日志配置
   */
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    format: z.enum(['json', 'pretty']).default('pretty'),
    output: z.enum(['stdout', 'file', 'both']).default('stdout'),
    file: z.string().optional(),
  }).default({}),
  
  /**
   * 数据库配置
   */
  database: z.object({
    path: z.string().default('./data/matrix.db'),
    backupInterval: z.number().default(86400000), // 24小时
    maxSizeMB: z.number().default(1024),
  }).default({}),
  
  /**
   * 工作流配置
   */
  workflow: z.object({
    globalTimeoutMs: z.number().default(300000), // 5分钟
    maxConcurrent: z.number().default(10),
    defaultRetryCount: z.number().default(2),
    defaultRetryDelayMs: z.number().default(1000),
  }).default({}),
  
  /**
   * Agent 配置
   */
  agent: z.object({
    defaultTimeoutMs: z.number().default(60000),
    maxConcurrency: z.number().default(5),
  }).default({}),
  
  /**
   * LLM 提供商配置
   */
  llm: z.object({
    providers: z.record(z.object({
      apiKey: z.string().optional(),
      baseUrl: z.string().optional(),
      defaultModel: z.string().optional(),
      timeoutMs: z.number().default(30000),
      rateLimit: z.object({
        requestsPerMinute: z.number().default(60),
        tokensPerMinute: z.number().default(100000),
      }).optional(),
    })).default({}),
  }).default({}),
  
  /**
   * 安全配置
   */
  security: z.object({
    enableApiKey: z.boolean().default(false),
    apiKeys: z.array(z.string()).default([]),
    allowedOrigins: z.array(z.string()).default([]),
    maxRequestSize: z.number().default(10485760), // 10MB
  }).default({}),
  
  /**
   * 监控配置
   */
  monitoring: z.object({
    enabled: z.boolean().default(true),
    metricsInterval: z.number().default(60000),
    healthCheckInterval: z.number().default(30000),
    enablePrometheus: z.boolean().default(false),
    prometheusPort: z.number().default(9090),
  }).default({}),
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

/**
 * 默认配置
 */
const defaultConfig: RuntimeConfig = {
  env: 'development',
  logging: {
    level: 'info',
    format: 'pretty',
    output: 'stdout',
  },
  database: {
    path: './data/matrix.db',
    backupInterval: 86400000,
    maxSizeMB: 1024,
  },
  workflow: {
    globalTimeoutMs: 300000,
    maxConcurrent: 10,
    defaultRetryCount: 2,
    defaultRetryDelayMs: 1000,
  },
  agent: {
    defaultTimeoutMs: 60000,
    maxConcurrency: 5,
  },
  llm: {
    providers: {},
  },
  security: {
    enableApiKey: false,
    apiKeys: [],
    allowedOrigins: [],
    maxRequestSize: 10485760,
  },
  monitoring: {
    enabled: true,
    metricsInterval: 60000,
    healthCheckInterval: 30000,
    enablePrometheus: false,
    prometheusPort: 9090,
  },
};

/**
 * 加载配置文件
 */
export async function loadConfig(configPath?: string): Promise<RuntimeConfig> {
  const paths = [
    configPath,
    './matrix.yaml',
    './matrix.yml',
    './config/matrix.yaml',
    './config/matrix.yml',
  ].filter(Boolean) as string[];

  for (const path of paths) {
    const fullPath = resolve(path);
    if (existsSync(fullPath)) {
      const content = await readFile(fullPath, 'utf-8');
      const parsed = parse(content);
      return mergeConfig(defaultConfig, parsed);
    }
  }

  // 尝试从环境变量加载
  return loadConfigFromEnv(defaultConfig);
}

/**
 * 从环境变量加载配置
 */
function loadConfigFromEnv(baseConfig: RuntimeConfig): RuntimeConfig {
  const config = { ...baseConfig };

  // 环境
  if (process.env.MATRIX_ENV) {
    config.env = process.env.MATRIX_ENV as RuntimeConfig['env'];
  }

  // 日志
  if (process.env.MATRIX_LOG_LEVEL) {
    config.logging.level = process.env.MATRIX_LOG_LEVEL as RuntimeConfig['logging']['level'];
  }
  if (process.env.MATRIX_LOG_FORMAT) {
    config.logging.format = process.env.MATRIX_LOG_FORMAT as RuntimeConfig['logging']['format'];
  }

  // 数据库
  if (process.env.MATRIX_DB_PATH) {
    config.database.path = process.env.MATRIX_DB_PATH;
  }

  // LLM API Keys
  if (process.env.ANTHROPIC_API_KEY) {
    config.llm.providers.anthropic = {
      ...config.llm.providers.anthropic,
      apiKey: process.env.ANTHROPIC_API_KEY,
    };
  }
  if (process.env.OPENAI_API_KEY) {
    config.llm.providers.openai = {
      ...config.llm.providers.openai,
      apiKey: process.env.OPENAI_API_KEY,
    };
  }

  // 安全配置
  if (process.env.MATRIX_API_KEY) {
    config.security.enableApiKey = true;
    config.security.apiKeys = process.env.MATRIX_API_KEY.split(',');
  }

  return config;
}

/**
 * 合并配置
 */
function mergeConfig(base: RuntimeConfig, override: Partial<RuntimeConfig>): RuntimeConfig {
  return {
    ...base,
    ...override,
    logging: { ...base.logging, ...override.logging },
    database: { ...base.database, ...override.database },
    workflow: { ...base.workflow, ...override.workflow },
    agent: { ...base.agent, ...override.agent },
    llm: {
      ...base.llm,
      ...override.llm,
      providers: { ...base.llm.providers, ...override.llm?.providers },
    },
    security: { ...base.security, ...override.security },
    monitoring: { ...base.monitoring, ...override.monitoring },
  };
}

/**
 * 验证配置
 */
export function validateConfig(config: unknown): { success: true; data: RuntimeConfig } | { success: false; errors: string[] } {
  const result = runtimeConfigSchema.safeParse(config);
  
  if (result.success) {
    return { success: true, data: result.data };
  }
  
  return {
    success: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
  };
}

/**
 * 全局配置实例
 */
let globalConfig: RuntimeConfig | null = null;

export async function initializeConfig(configPath?: string): Promise<RuntimeConfig> {
  globalConfig = await loadConfig(configPath);
  return globalConfig;
}

export function getConfig(): RuntimeConfig {
  if (!globalConfig) {
    throw new Error('Configuration not initialized. Call initializeConfig() first.');
  }
  return globalConfig;
}

export function setConfig(config: RuntimeConfig): void {
  globalConfig = config;
}
