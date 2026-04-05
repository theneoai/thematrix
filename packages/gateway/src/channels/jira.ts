/**
 * Jira Channel Adapter
 *
 * Handles Jira webhook events and normalizes them into TriggerEvents.
 * Supports: jira:issue_created, jira:issue_updated, comment_created
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
import { createTriggerEvent } from '../normalizer.js';

export class JiraChannelAdapter implements ChannelAdapter {
  readonly platform = 'jira' as const;
  private readonly logger: Logger;
  private readonly baseUrl?: string;

  constructor(config?: Record<string, unknown>) {
    this.logger = new Logger({ prefix: 'gateway:jira' });
    this.baseUrl = (config?.baseUrl as string) ?? undefined;
  }

  async parseEvent(req: IncomingRequest): Promise<TriggerEvent | null> {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object') {
      this.logger.warn('Received empty or non-object body');
      return null;
    }

    const eventType = body.webhookEvent as string;
    if (!eventType) {
      this.logger.warn('Missing webhookEvent field');
      return null;
    }

    const source = this.extractSource(body);
    const payload = this.extractPayload(eventType, body);

    this.logger.info(`Parsed Jira event: ${eventType} for ${payload.issueKey ?? 'unknown'}`);

    return createTriggerEvent('jira', eventType, source, payload, body);
  }

  verifySignature(req: IncomingRequest, secret: string): boolean {
    // Atlassian Connect webhook signing uses a shared secret with HMAC-SHA256
    // The signature is sent in the x-hub-signature header
    const signature = req.headers['x-hub-signature'] as string | undefined;
    if (!signature) {
      this.logger.warn('Missing x-hub-signature header');
      return false;
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      this.logger.warn('Missing rawBody for signature verification');
      return false;
    }

    const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  async sendNotification(target: NotificationTarget, message: NotificationMessage): Promise<void> {
    const jiraUrl = (target.config?.jiraUrl as string) ?? this.baseUrl;
    if (!jiraUrl) {
      throw new Error('Jira base URL not configured');
    }

    const issueKey = target.config?.issueKey as string;
    if (!issueKey) {
      throw new Error('issueKey is required in notification target config');
    }

    const url = `${jiraUrl}/rest/api/2/issue/${issueKey}/comment`;

    const commentBody = this.formatNotificationAsADF(message);

    this.logger.info(`Sending comment to Jira issue ${issueKey}`);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Support both basic auth and bearer token
    if (target.config?.authHeader) {
      headers['Authorization'] = target.config.authHeader as string;
    } else if (target.config?.email && target.config?.apiToken) {
      const credentials = Buffer.from(
        `${target.config.email}:${target.config.apiToken}`,
      ).toString('base64');
      headers['Authorization'] = `Basic ${credentials}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ body: commentBody }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Jira API error: ${response.status} ${text}`);
    }
  }

  private extractSource(body: Record<string, unknown>): TriggerEventSource {
    const issue = body.issue as Record<string, unknown> | undefined;
    const fields = issue?.fields as Record<string, unknown> | undefined;
    const user = body.user as Record<string, unknown> | undefined;
    const project = fields?.project as Record<string, unknown> | undefined;

    return {
      project: (project?.key as string) ?? (project?.name as string) ?? undefined,
      author: (user?.displayName as string) ?? (user?.name as string) ?? undefined,
    };
  }

  private extractPayload(eventType: string, body: Record<string, unknown>): Record<string, unknown> {
    const issue = body.issue as Record<string, unknown> | undefined;
    const fields = issue?.fields as Record<string, unknown> | undefined;
    const assignee = fields?.assignee as Record<string, unknown> | undefined;
    const priority = fields?.priority as Record<string, unknown> | undefined;
    const status = fields?.status as Record<string, unknown> | undefined;

    const payload: Record<string, unknown> = {
      eventType,
      issueKey: issue?.key,
      issueId: issue?.id,
      summary: fields?.summary,
      description: fields?.description,
      issueType: (fields?.issuetype as Record<string, unknown>)?.name,
      assignee: assignee?.displayName ?? assignee?.name,
      priority: priority?.name,
      status: status?.name,
    };

    switch (eventType) {
      case 'jira:issue_updated': {
        const changelog = body.changelog as Record<string, unknown> | undefined;
        const items = changelog?.items as Array<Record<string, unknown>> | undefined;
        if (items) {
          payload.changes = items.map((item) => ({
            field: item.field,
            fromString: item.fromString,
            toString: item.toString,
          }));
        }
        break;
      }

      case 'comment_created':
      case 'comment_updated': {
        const comment = body.comment as Record<string, unknown> | undefined;
        payload.commentId = comment?.id;
        payload.commentBody = comment?.body;
        payload.commentAuthor = (comment?.author as Record<string, unknown>)?.displayName;
        break;
      }
    }

    return payload;
  }

  /**
   * Format notification as plain text for Jira comment body.
   * For Jira Cloud with ADF, a more complex structure would be needed.
   */
  private formatNotificationAsADF(message: NotificationMessage): string {
    const parts: string[] = [];

    if (message.title) {
      parts.push(`*[${message.level.toUpperCase()}] ${message.title}*`);
    }
    parts.push(message.content);

    if (message.fields?.length) {
      parts.push('');
      for (const field of message.fields) {
        parts.push(`*${field.label}:* ${field.value}`);
      }
    }

    if (message.actions?.length) {
      parts.push('');
      for (const action of message.actions) {
        parts.push(`[${action.label}|${action.url}]`);
      }
    }

    return parts.join('\n');
  }
}
