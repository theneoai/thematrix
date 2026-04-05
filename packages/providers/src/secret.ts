/**
 * Secret Manager - 凭证管理（借鉴 OpenClaw SecretRef 模式）
 *
 * 支持从环境变量、Vault、文件中解析密钥
 * 解耦密钥引用和实际值，支持凭证轮换
 */

import type { SecretRef } from '@thematrix/types';
import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'SecretManager' });

export class SecretManager {
  private cache = new Map<string, { value: string; expiresAt?: number }>();
  private cacheTtlMs: number;

  constructor(options?: { cacheTtlMs?: number }) {
    this.cacheTtlMs = options?.cacheTtlMs ?? 300_000; // 5 min default
  }

  /**
   * 解析 SecretRef 为实际值
   */
  async resolve(ref: SecretRef): Promise<string> {
    const cacheKey = `${ref.type}:${ref.ref}:${ref.version ?? ''}`;
    const cached = this.cache.get(cacheKey);
    if (cached && (!cached.expiresAt || cached.expiresAt > Date.now())) {
      return cached.value;
    }

    let value: string;

    switch (ref.type) {
      case 'env':
        value = this.resolveEnv(ref.ref);
        break;
      case 'file':
        value = await this.resolveFile(ref.ref);
        break;
      case 'vault':
        value = await this.resolveVault(ref.ref);
        break;
      default:
        throw new Error(`Unknown SecretRef type: ${ref.type}`);
    }

    this.cache.set(cacheKey, {
      value,
      expiresAt: Date.now() + this.cacheTtlMs,
    });

    return value;
  }

  /**
   * 解析字符串或 SecretRef
   */
  async resolveValue(value: string | SecretRef): Promise<string> {
    if (typeof value === 'string') {
      // 支持 ${ENV_VAR} 语法
      if (value.startsWith('${') && value.endsWith('}')) {
        const envVar = value.slice(2, -1);
        return this.resolveEnv(envVar);
      }
      return value;
    }
    return this.resolve(value);
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  private resolveEnv(envVar: string): string {
    const value = process.env[envVar];
    if (!value) {
      throw new Error(`Environment variable not found: ${envVar}`);
    }
    return value;
  }

  private async resolveFile(filePath: string): Promise<string> {
    const fs = await import('node:fs/promises');
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return content.trim();
    } catch (error) {
      throw new Error(`Failed to read secret file: ${filePath} — ${error}`);
    }
  }

  private async resolveVault(_path: string): Promise<string> {
    // Vault 集成预留接口
    // 实际实现需要 HashiCorp Vault client 或类似服务
    throw new Error('Vault secret resolution not yet implemented');
  }
}
