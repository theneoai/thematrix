/**
 * MonitorServer - Main entry point combining API, SSE, Alerts, and Health
 */

import { createServer, type Server } from 'node:http';
import type { IMonitorServer, MonitorConfig, DomainEvent, AlertRule, Alert } from '@thematrix/types';
import { Logger } from '@thematrix/utils';
import { MonitorAPI, type MonitorDataProviders } from './api.js';
import { SSEManager } from './websocket.js';
import { AlertManager, type AlertCallback } from './alerts.js';
import { HealthAggregator, type HealthCheckResult } from './health.js';

export interface MonitorServerOptions {
  config: MonitorConfig;
  providers?: MonitorDataProviders;
  onAlert?: AlertCallback;
}

export class MonitorServer implements IMonitorServer {
  private readonly logger = new Logger({ prefix: 'MonitorServer' });
  private readonly config: MonitorConfig;
  private readonly api: MonitorAPI;
  private readonly sse: SSEManager;
  private readonly alerts: AlertManager;
  private readonly health: HealthAggregator;
  private server: Server | null = null;
  private port = 0;

  constructor(options: MonitorServerOptions) {
    this.config = options.config;

    // Initialize subsystems
    this.alerts = new AlertManager(options.onAlert);
    this.health = new HealthAggregator();
    this.sse = new SSEManager();

    // Wire alert rules from config
    if (options.config.alertRules) {
      for (const rule of options.config.alertRules) {
        this.alerts.addRule(rule);
      }
    }

    // Build providers with alert/health integration
    const providers: MonitorDataProviders = {
      ...options.providers,
      getActiveAlerts: () => this.alerts.getActiveAlerts(),
      getAlertRules: () => this.alerts.getRules(),
      getMetrics: options.providers?.getMetrics ?? (() => this.buildDefaultMetrics()),
    };

    this.api = new MonitorAPI(providers);

    // Register default health checks
    this.health.registerCheck('server', async () => ({
      status: 'healthy' as const,
      message: 'Monitor server is running',
    }));

    this.health.registerCheck('sse', async () => ({
      status: 'healthy' as const,
      details: { connections: this.sse.getConnectionCount() },
    }));
  }

  /** Access the AlertManager directly */
  getAlertManager(): AlertManager {
    return this.alerts;
  }

  /** Access the HealthAggregator directly */
  getHealthAggregator(): HealthAggregator {
    return this.health;
  }

  /** Access the SSEManager directly */
  getSSEManager(): SSEManager {
    return this.sse;
  }

  /** Register a health check */
  registerHealthCheck(name: string, checker: () => Promise<HealthCheckResult>): void {
    this.health.registerCheck(name, checker);
  }

  /** Add an alert rule */
  addAlertRule(rule: AlertRule): void {
    this.alerts.addRule(rule);
  }

  /** Evaluate a metric against alert rules */
  evaluateMetric(metric: string, value: number): void {
    this.alerts.evaluate(metric, value);
  }

  /** Broadcast a domain event to all SSE clients */
  broadcastEvent(event: DomainEvent): void {
    this.sse.broadcast(event);
  }

  /** Start the HTTP server */
  async start(): Promise<void> {
    const port = this.config.port;
    const host = this.config.host ?? '0.0.0.0';

    this.server = createServer(async (req, res) => {
      const url = req.url ?? '/';

      // SSE endpoint
      if (url.startsWith('/api/events/stream')) {
        this.sse.handleConnection(req, res);
        return;
      }

      // Health endpoint with aggregated data
      if (url === '/health') {
        try {
          const healthResult = await this.health.checkAll();
          const statusCode = healthResult.status === 'healthy' ? 200
            : healthResult.status === 'degraded' ? 200 : 503;
          this.api.sendJson(res, statusCode, healthResult);
        } catch (err) {
          this.api.sendJson(res, 503, { status: 'unhealthy', error: 'Health check failed' });
        }
        return;
      }

      // Delegate to API router
      await this.api.handleRequest(req, res);
    });

    return new Promise<void>((resolve, reject) => {
      this.server!.on('error', reject);
      this.server!.listen(port, host, () => {
        this.port = port;
        this.logger.info(`Monitor server listening on ${host}:${port}`);
        resolve();
      });
    });
  }

  /** Stop the server gracefully */
  async stop(): Promise<void> {
    this.sse.shutdown();

    if (this.server) {
      return new Promise<void>((resolve) => {
        this.server!.close(() => {
          this.logger.info('Monitor server stopped');
          this.server = null;
          resolve();
        });
      });
    }
  }

  /** Get the port the server is listening on */
  getPort(): number {
    return this.port;
  }

  // ----------------------------------------------------------
  // Default Metrics
  // ----------------------------------------------------------

  private async buildDefaultMetrics(): Promise<string> {
    const lines: string[] = [];
    lines.push('# HELP monitor_sse_connections Number of active SSE connections');
    lines.push('# TYPE monitor_sse_connections gauge');
    lines.push(`monitor_sse_connections ${this.sse.getConnectionCount()}`);
    lines.push('');
    lines.push('# HELP monitor_active_alerts Number of active alerts');
    lines.push('# TYPE monitor_active_alerts gauge');
    lines.push(`monitor_active_alerts ${this.alerts.getActiveAlerts().length}`);
    lines.push('');
    lines.push('# HELP monitor_alert_rules Number of configured alert rules');
    lines.push('# TYPE monitor_alert_rules gauge');
    lines.push(`monitor_alert_rules ${this.alerts.getRules().length}`);
    lines.push('');
    return lines.join('\n') + '\n';
  }
}
