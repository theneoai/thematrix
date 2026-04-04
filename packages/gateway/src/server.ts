/**
 * Gateway HTTP Server
 *
 * Creates an HTTP server using Node.js built-in http module.
 * Routes incoming webhooks to the appropriate channel adapter,
 * verifies signatures, parses events, and emits TriggerEvents.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type {
  ChannelAdapter,
  ChannelConfig,
  GatewayConfig,
  IncomingRequest,
  TriggerEvent,
} from '@thematrix/types';
import { Logger } from '@thematrix/utils';
import { GerritChannelAdapter } from './channels/gerrit.js';
import { JiraChannelAdapter } from './channels/jira.js';
import { GitLabChannelAdapter } from './channels/gitlab.js';
import { FeishuChannelAdapter } from './channels/feishu.js';
import { WeChatChannelAdapter } from './channels/wechat.js';
import { CustomChannelAdapter } from './channels/custom.js';
import { DingTalkChannelAdapter } from './channels/dingtalk.js';
import { SlackChannelAdapter } from './channels/slack.js';

export type TriggerCallback = (event: TriggerEvent) => void | Promise<void>;

export class GatewayServer {
  private readonly server: Server;
  private readonly logger: Logger;
  private readonly basePath: string;
  private readonly adapters: Map<string, ChannelAdapter> = new Map();
  private readonly channelConfigs: Map<string, ChannelConfig> = new Map();
  private readonly onTrigger: TriggerCallback;

  constructor(config: GatewayConfig, onTrigger: TriggerCallback) {
    this.logger = new Logger({ prefix: 'gateway' });
    this.basePath = config.basePath ?? '/hooks';
    this.onTrigger = onTrigger;

    // Register channel adapters from config
    for (const channelConfig of config.channels) {
      if (!channelConfig.enabled) continue;
      const adapter = this.createAdapter(channelConfig);
      if (adapter) {
        const path = channelConfig.path ?? `/${channelConfig.platform}`;
        this.adapters.set(path, adapter);
        this.channelConfigs.set(path, channelConfig);
        this.logger.info(`Registered channel: ${channelConfig.platform} at ${this.basePath}${path}`);
      }
    }

    this.server = createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        this.logger.error('Unhandled error in request handler', err);
        if (!res.writableEnded) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      });
    });
  }

  /**
   * Start the HTTP server on the specified port.
   */
  async start(port: number, host?: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.server.on('error', reject);
      this.server.listen(port, host ?? '0.0.0.0', () => {
        this.logger.info(`Gateway server listening on ${host ?? '0.0.0.0'}:${port}`);
        resolve();
      });
    });
  }

  /**
   * Stop the HTTP server gracefully.
   */
  async stop(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.server.close((err) => {
        if (err) {
          this.logger.error('Error stopping server', err);
          reject(err);
        } else {
          this.logger.info('Gateway server stopped');
          resolve();
        }
      });
    });
  }

  /**
   * Register a channel adapter at a specific path.
   */
  registerAdapter(path: string, adapter: ChannelAdapter, config?: ChannelConfig): void {
    this.adapters.set(path, adapter);
    if (config) {
      this.channelConfigs.set(path, config);
    }
    this.logger.info(`Registered adapter: ${adapter.platform} at ${this.basePath}${path}`);
  }

  private createAdapter(config: ChannelConfig): ChannelAdapter | null {
    switch (config.platform) {
      case 'gerrit':
        return new GerritChannelAdapter(config.config);
      case 'jira':
        return new JiraChannelAdapter(config.config);
      case 'gitlab':
        return new GitLabChannelAdapter(config.config);
      case 'feishu':
        return new FeishuChannelAdapter(config.config);
      case 'wechat':
        return new WeChatChannelAdapter(config.config);
      case 'custom':
        return new CustomChannelAdapter(config.config);
      case 'dingtalk':
        return new DingTalkChannelAdapter(config.config);
      case 'slack':
        return new SlackChannelAdapter(config.config);
      default:
        this.logger.warn(`Unknown platform: ${config.platform}`);
        return null;
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;

    // Health check endpoint
    if (path === '/health' || path === `${this.basePath}/health`) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', channels: Array.from(this.adapters.keys()) }));
      return;
    }

    // Check if path matches basePath + channelPath
    if (!path.startsWith(this.basePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    const channelPath = path.slice(this.basePath.length) || '/';
    const adapter = this.adapters.get(channelPath);

    if (!adapter) {
      this.logger.warn(`No adapter found for path: ${channelPath}`);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `No channel adapter for path: ${channelPath}` }));
      return;
    }

    // Only accept POST requests for webhooks
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    // Read and parse body
    const rawBody = await this.readBody(req);
    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString('utf-8'));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    // Build IncomingRequest
    const query: Record<string, string> = {};
    for (const [key, value] of url.searchParams.entries()) {
      query[key] = value;
    }

    const incomingRequest: IncomingRequest = {
      method: req.method ?? 'POST',
      path,
      headers: req.headers as Record<string, string | string[]>,
      body,
      query,
      rawBody,
    };

    // Verify signature if secret is configured
    const channelConfig = this.channelConfigs.get(channelPath);
    if (channelConfig?.secret) {
      const isValid = adapter.verifySignature(incomingRequest, channelConfig.secret);
      if (!isValid) {
        this.logger.warn(`Signature verification failed for ${adapter.platform}`);
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Signature verification failed' }));
        return;
      }
    }

    // Parse event
    let event: TriggerEvent | null;
    try {
      event = await adapter.parseEvent(incomingRequest);
    } catch (err) {
      this.logger.error(`Error parsing event from ${adapter.platform}`, err);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to parse event' }));
      return;
    }

    if (!event) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ignored', message: 'Event not recognized or filtered' }));
      return;
    }

    // Handle special events (e.g., URL verification challenges)
    if (event.eventType === 'url_verification') {
      const challenge = event.payload.challenge ?? event.payload.echostr;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ challenge }));
      return;
    }

    // Emit trigger event
    try {
      await this.onTrigger(event);
    } catch (err) {
      this.logger.error(`Error in trigger callback for event ${event.id}`, err);
      // Still return 200 to acknowledge receipt - we don't want the sender to retry
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'accepted',
      eventId: event.id,
      platform: event.platform,
      eventType: event.eventType,
    }));
  }

  private readBody(req: IncomingMessage, maxSize = 10 * 1024 * 1024): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalSize = 0;
      req.on('data', (chunk: Buffer) => {
        totalSize += chunk.length;
        if (totalSize > maxSize) {
          req.destroy();
          reject(new Error(`Request body exceeds maximum size of ${maxSize} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }
}
