/**
 * Custom Channel Adapter
 *
 * A generic webhook handler that uses configurable patterns to extract
 * fields from arbitrary webhook payloads. Supports configurable HMAC
 * or token-based verification.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  ChannelAdapter,
  IncomingRequest,
  NotificationMessage,
  NotificationTarget,
  TriggerEvent,
  TriggerEventSource,
} from '@thematrix/types';
import { Logger } from '@thematrix/utils';
import { createTriggerEvent, resolvePath } from '../normalizer.js';

export interface CustomAdapterConfig {
  /** Dot-path to extract the event type from the payload (e.g., "action", "event.type") */
  eventTypePath?: string;
  /** Default event type if path extraction fails */
  defaultEventType?: string;

  /** Source field extraction paths */
  sourcePaths?: {
    project?: string;
    repository?: string;
    branch?: string;
    author?: string;
    channel?: string;
  };

  /** Additional payload field extraction: { outputKey: "dot.path.in.body" } */
  payloadPaths?: Record<string, string>;

  /** Signature verification config */
  verification?: {
    /** Verification type */
    type: 'hmac' | 'token';
    /** For HMAC: hash algorithm (default: sha256) */
    algorithm?: string;
    /** For HMAC: header containing the signature */
    signatureHeader?: string;
    /** For HMAC: prefix before the hex digest (e.g., "sha256=") */
    signaturePrefix?: string;
    /** For token: header containing the token */
    tokenHeader?: string;
  };

  /** Outbound webhook URL for notifications */
  notificationUrl?: string;
  /** Outbound webhook headers */
  notificationHeaders?: Record<string, string>;
}

export class CustomChannelAdapter implements ChannelAdapter {
  readonly platform = 'custom' as const;
  private readonly logger: Logger;
  private readonly config: CustomAdapterConfig;

  constructor(config?: Record<string, unknown>) {
    this.logger = new Logger({ prefix: 'gateway:custom' });
    this.config = (config ?? {}) as CustomAdapterConfig;
  }

  async parseEvent(req: IncomingRequest): Promise<TriggerEvent | null> {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object') {
      this.logger.warn('Received empty or non-object body');
      return null;
    }

    // Extract event type
    let eventType = this.config.defaultEventType ?? 'custom_event';
    if (this.config.eventTypePath) {
      const extracted = resolvePath(body, this.config.eventTypePath);
      if (typeof extracted === 'string') {
        eventType = extracted;
      }
    }

    // Try common event type locations if no path configured
    if (!this.config.eventTypePath) {
      const commonPaths = ['action', 'event', 'type', 'event_type', 'eventType'];
      for (const path of commonPaths) {
        const val = resolvePath(body, path);
        if (typeof val === 'string') {
          eventType = val;
          break;
        }
      }
    }

    const source = this.extractSource(body);
    const payload = this.extractPayload(eventType, body);

    this.logger.info(`Parsed custom event: ${eventType}`);

    return createTriggerEvent('custom', eventType, source, payload, body);
  }

  verifySignature(req: IncomingRequest, secret: string): boolean {
    const verification = this.config.verification;

    if (!verification) {
      // Default: try HMAC-SHA256 with common header names
      return this.verifyHmac(req, secret, 'sha256', 'x-hub-signature-256', 'sha256=');
    }

    if (verification.type === 'token') {
      return this.verifyToken(req, secret, verification.tokenHeader ?? 'x-webhook-token');
    }

    // HMAC verification
    return this.verifyHmac(
      req,
      secret,
      verification.algorithm ?? 'sha256',
      verification.signatureHeader ?? 'x-hub-signature-256',
      verification.signaturePrefix ?? 'sha256=',
    );
  }

  async sendNotification(target: NotificationTarget, message: NotificationMessage): Promise<void> {
    const url = target.webhookUrl ?? this.config.notificationUrl;
    if (!url) {
      throw new Error('No webhook URL configured for custom notification');
    }

    this.logger.info(`Sending notification to custom webhook: ${url}`);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.config.notificationHeaders ?? {}),
    };

    // Add any auth headers from target config
    if (target.config?.authHeader) {
      headers['Authorization'] = target.config.authHeader as string;
    }

    const body = {
      title: message.title,
      content: message.content,
      level: message.level,
      fields: message.fields,
      actions: message.actions,
      timestamp: new Date().toISOString(),
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Custom webhook error: ${response.status} ${text}`);
    }
  }

  private extractSource(body: Record<string, unknown>): TriggerEventSource {
    const paths = this.config.sourcePaths;
    if (!paths) {
      // Try common field names
      return {
        project: this.resolveString(body, 'project') ?? this.resolveString(body, 'repository.name'),
        repository: this.resolveString(body, 'repository.url') ?? this.resolveString(body, 'repo'),
        branch: this.resolveString(body, 'branch') ?? this.resolveString(body, 'ref'),
        author: this.resolveString(body, 'author') ?? this.resolveString(body, 'user.name') ?? this.resolveString(body, 'sender'),
        channel: this.resolveString(body, 'channel') ?? this.resolveString(body, 'chat_id'),
      };
    }

    return {
      project: paths.project ? this.resolveString(body, paths.project) : undefined,
      repository: paths.repository ? this.resolveString(body, paths.repository) : undefined,
      branch: paths.branch ? this.resolveString(body, paths.branch) : undefined,
      author: paths.author ? this.resolveString(body, paths.author) : undefined,
      channel: paths.channel ? this.resolveString(body, paths.channel) : undefined,
    };
  }

  private extractPayload(eventType: string, body: Record<string, unknown>): Record<string, unknown> {
    const payload: Record<string, unknown> = { eventType };

    if (this.config.payloadPaths) {
      for (const [key, path] of Object.entries(this.config.payloadPaths)) {
        const value = resolvePath(body, path);
        if (value !== undefined) {
          payload[key] = value;
        }
      }
    } else {
      // If no paths configured, include all top-level fields
      for (const [key, value] of Object.entries(body)) {
        payload[key] = value;
      }
    }

    return payload;
  }

  private resolveString(obj: unknown, path: string): string | undefined {
    const value = resolvePath(obj, path);
    return typeof value === 'string' ? value : undefined;
  }

  private verifyHmac(
    req: IncomingRequest,
    secret: string,
    algorithm: string,
    signatureHeader: string,
    prefix: string,
  ): boolean {
    const signature = req.headers[signatureHeader.toLowerCase()] as string | undefined;
    if (!signature) {
      this.logger.warn(`Missing ${signatureHeader} header`);
      return false;
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      this.logger.warn('Missing rawBody for HMAC verification');
      return false;
    }

    const expected = prefix + createHmac(algorithm, secret).update(rawBody).digest('hex');

    try {
      const sigBuf = Buffer.from(signature);
      const expectedBuf = Buffer.from(expected);
      if (sigBuf.length !== expectedBuf.length) return false;
      return timingSafeEqual(sigBuf, expectedBuf);
    } catch {
      return false;
    }
  }

  private verifyToken(req: IncomingRequest, secret: string, tokenHeader: string): boolean {
    const token = req.headers[tokenHeader.toLowerCase()] as string | undefined;
    if (!token) {
      this.logger.warn(`Missing ${tokenHeader} header`);
      return false;
    }

    try {
      const tokenBuf = Buffer.from(token);
      const secretBuf = Buffer.from(secret);
      if (tokenBuf.length !== secretBuf.length) return false;
      return timingSafeEqual(tokenBuf, secretBuf);
    } catch {
      return false;
    }
  }
}
