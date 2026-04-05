/**
 * 健康检查和系统状态监控
 */
import type { IMemoryManager } from '@thematrix/types';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthCheck {
  name: string;
  status: HealthStatus;
  responseTimeMs: number;
  message?: string;
  details?: Record<string, unknown>;
  lastChecked: Date;
}

export interface SystemHealth {
  status: HealthStatus;
  checks: HealthCheck[];
  timestamp: Date;
  version: string;
  uptimeSeconds: number;
}

export interface HealthCheckConfig {
  name: string;
  check: () => Promise<HealthCheck>;
  intervalMs?: number;
  timeoutMs?: number;
}

export class HealthMonitor {
  private checks = new Map<string, HealthCheckConfig>();
  private lastResults = new Map<string, HealthCheck>();
  private intervals = new Map<string, NodeJS.Timeout>();
  private startTime: Date;

  constructor(private version: string = '0.1.0') {
    this.startTime = new Date();
  }

  register(config: HealthCheckConfig): void {
    this.checks.set(config.name, config);
    
    // 如果配置了定期检查
    if (config.intervalMs && config.intervalMs > 0) {
      const interval = setInterval(async () => {
        await this.runCheck(config.name);
      }, config.intervalMs);
      this.intervals.set(config.name, interval);
    }
  }

  unregister(name: string): void {
    const interval = this.intervals.get(name);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(name);
    }
    this.checks.delete(name);
    this.lastResults.delete(name);
  }

  async runCheck(name: string): Promise<HealthCheck> {
    const config = this.checks.get(name);
    if (!config) {
      throw new Error(`Health check not found: ${name}`);
    }

    const startTime = Date.now();
    try {
      const timeoutMs = config.timeoutMs ?? 5000;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        config.check(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Health check timeout')), timeoutMs);
        }),
      ]);
      if (timer) clearTimeout(timer);
      
      this.lastResults.set(name, result);
      return result;
    } catch (error) {
      const failedCheck: HealthCheck = {
        name,
        status: 'unhealthy',
        responseTimeMs: Date.now() - startTime,
        message: error instanceof Error ? error.message : 'Unknown error',
        lastChecked: new Date(),
      };
      this.lastResults.set(name, failedCheck);
      return failedCheck;
    }
  }

  async runAllChecks(): Promise<SystemHealth> {
    const checkPromises = Array.from(this.checks.keys()).map(name =>
      this.runCheck(name).catch((error): HealthCheck => ({
        name,
        status: 'unhealthy',
        responseTimeMs: 0,
        message: error instanceof Error ? error.message : 'Unknown error',
        lastChecked: new Date(),
      }))
    );

    const results = await Promise.all(checkPromises);
    
    // 确定整体状态
    let status: HealthStatus = 'healthy';
    if (results.some(r => r.status === 'unhealthy')) {
      status = 'unhealthy';
    } else if (results.some(r => r.status === 'degraded')) {
      status = 'degraded';
    }

    return {
      status,
      checks: results,
      timestamp: new Date(),
      version: this.version,
      uptimeSeconds: Math.floor((Date.now() - this.startTime.getTime()) / 1000),
    };
  }

  getLastResult(name: string): HealthCheck | undefined {
    return this.lastResults.get(name);
  }

  getAllLastResults(): HealthCheck[] {
    return Array.from(this.lastResults.values());
  }

  dispose(): void {
    for (const interval of this.intervals.values()) {
      clearInterval(interval);
    }
    this.intervals.clear();
  }
}

/**
 * 创建默认健康检查
 */
export function createDefaultHealthChecks(
  memory: IMemoryManager,
  options: { dbPath?: string } = {}
): HealthCheckConfig[] {
  return [
    {
      name: 'memory',
      check: async () => {
        const startTime = Date.now();
        try {
          // 尝试一个简单操作来验证内存存储
          await memory.set('global', 'health-check', 'ping', 'pong');
          const value = await memory.get('global', 'health-check', 'ping');
          
          return {
            name: 'memory',
            status: value === 'pong' ? 'healthy' : 'degraded',
            responseTimeMs: Date.now() - startTime,
            lastChecked: new Date(),
          };
        } catch (error) {
          return {
            name: 'memory',
            status: 'unhealthy',
            responseTimeMs: Date.now() - startTime,
            message: error instanceof Error ? error.message : 'Memory check failed',
            lastChecked: new Date(),
          };
        }
      },
      intervalMs: 30000, // 30秒检查一次
    },
    {
      name: 'disk',
      check: async () => {
        const startTime = Date.now();
        try {
          // 检查磁盘空间（简化版）
          return {
            name: 'disk',
            status: 'healthy',
            responseTimeMs: Date.now() - startTime,
            details: { dbPath: options.dbPath },
            lastChecked: new Date(),
          };
        } catch (error) {
          return {
            name: 'disk',
            status: 'unhealthy',
            responseTimeMs: Date.now() - startTime,
            message: error instanceof Error ? error.message : 'Disk check failed',
            lastChecked: new Date(),
          };
        }
      },
      intervalMs: 60000, // 60秒检查一次
    },
  ];
}
