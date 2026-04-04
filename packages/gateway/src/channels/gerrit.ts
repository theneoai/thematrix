/**
 * Gerrit Channel Adapter
 *
 * Handles Gerrit webhook events and normalizes them into TriggerEvents.
 * Supports: patchset-created, change-merged, comment-added
 */

import { createHmac } from 'node:crypto';
import type {
  ChannelAdapter,
  IncomingRequest,
  NotificationMessage,
  NotificationTarget,
  TriggerEvent,
  TriggerEventSource,
} from '@thematrix/types';
import { Logger } from '@thematrix/utils';
import { createTriggerEvent } from '../normalizer.js';

export class GerritChannelAdapter implements ChannelAdapter {
  readonly platform = 'gerrit' as const;
  private readonly logger: Logger;
  private readonly baseUrl?: string;

  constructor(config?: Record<string, unknown>) {
    this.logger = new Logger({ prefix: 'gateway:gerrit' });
    this.baseUrl = (config?.baseUrl as string) ?? undefined;
  }

  async parseEvent(req: IncomingRequest): Promise<TriggerEvent | null> {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object') {
      this.logger.warn('Received empty or non-object body');
      return null;
    }

    const eventType = (body.type as string) ?? (req.headers['x-gerrit-event'] as string);
    if (!eventType) {
      this.logger.warn('Missing event type in body.type or x-gerrit-event header');
      return null;
    }

    const source = this.extractSource(eventType, body);
    const payload = this.extractPayload(eventType, body);

    this.logger.info(`Parsed Gerrit event: ${eventType} for ${source.project ?? 'unknown'}`);

    return createTriggerEvent('gerrit', eventType, source, payload, body);
  }

  verifySignature(req: IncomingRequest, secret: string): boolean {
    const signature = req.headers['x-gerrit-signature'] as string | undefined;
    if (!signature) {
      this.logger.warn('Missing x-gerrit-signature header');
      return false;
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      this.logger.warn('Missing rawBody for signature verification');
      return false;
    }

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    // Use timing-safe comparison
    try {
      const { timingSafeEqual } = require('node:crypto');
      return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return false;
    }
  }

  async sendNotification(target: NotificationTarget, message: NotificationMessage): Promise<void> {
    const gerritUrl = (target.config?.gerritUrl as string) ?? this.baseUrl;
    if (!gerritUrl) {
      throw new Error('Gerrit base URL not configured');
    }

    const changeId = target.config?.changeId as string;
    const revisionId = target.config?.revisionId as string ?? 'current';
    if (!changeId) {
      throw new Error('changeId is required in notification target config');
    }

    const url = `${gerritUrl}/a/changes/${encodeURIComponent(changeId)}/revisions/${revisionId}/review`;

    const reviewBody = JSON.stringify({
      message: this.formatNotificationMessage(message),
    });

    this.logger.info(`Sending review comment to Gerrit change ${changeId}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Gerrit uses HTTP basic auth; credentials should be in target.config
        ...(target.config?.authHeader
          ? { Authorization: target.config.authHeader as string }
          : {}),
      },
      body: reviewBody,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gerrit API error: ${response.status} ${text}`);
    }
  }

  private extractSource(eventType: string, body: Record<string, unknown>): TriggerEventSource {
    const change = body.change as Record<string, unknown> | undefined;
    const patchSet = body.patchSet as Record<string, unknown> | undefined;
    const author = (body.uploader ?? body.author ?? (patchSet?.uploader)) as Record<string, unknown> | undefined;

    return {
      project: change?.project as string | undefined,
      repository: change?.url as string | undefined,
      branch: change?.branch as string | undefined,
      author: (author?.name as string) ?? (author?.username as string) ?? undefined,
    };
  }

  private extractPayload(eventType: string, body: Record<string, unknown>): Record<string, unknown> {
    const change = body.change as Record<string, unknown> | undefined;
    const patchSet = body.patchSet as Record<string, unknown> | undefined;

    const payload: Record<string, unknown> = {
      eventType,
      project: change?.project,
      branch: change?.branch,
      changeId: change?.id,
      changeNumber: change?.number,
      changeUrl: change?.url,
      subject: change?.subject,
      status: change?.status,
    };

    if (patchSet) {
      payload.patchsetNumber = patchSet.number;
      payload.patchsetRef = patchSet.ref;
    }

    switch (eventType) {
      case 'patchset-created':
        payload.isDraft = patchSet?.isDraft ?? false;
        payload.kind = patchSet?.kind;
        break;

      case 'change-merged':
        payload.newRev = body.newRev;
        break;

      case 'comment-added': {
        const comment = body.comment as Record<string, unknown> | undefined;
        payload.commentMessage = comment?.message ?? body.comment;
        const approvals = body.approvals as Array<Record<string, unknown>> | undefined;
        if (approvals) {
          payload.approvals = approvals.map((a) => ({
            type: a.type,
            value: a.value,
          }));
        }
        break;
      }
    }

    return payload;
  }

  private formatNotificationMessage(message: NotificationMessage): string {
    const parts: string[] = [];

    if (message.title) {
      parts.push(`[${message.level.toUpperCase()}] ${message.title}`);
    }
    parts.push(message.content);

    if (message.fields?.length) {
      parts.push('');
      for (const field of message.fields) {
        parts.push(`${field.label}: ${field.value}`);
      }
    }

    if (message.actions?.length) {
      parts.push('');
      for (const action of message.actions) {
        parts.push(`${action.label}: ${action.url}`);
      }
    }

    return parts.join('\n');
  }
}
