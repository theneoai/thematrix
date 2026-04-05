/**
 * Slack Channel Adapter
 *
 * Handles Slack Events API callbacks (message, app_mention, url_verification)
 * and normalizes them into TriggerEvents.
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

export class SlackChannelAdapter implements ChannelAdapter {
  readonly platform = 'slack' as const;
  private readonly logger: Logger;

  constructor(config?: Record<string, unknown>) {
    this.logger = new Logger({ prefix: 'gateway:slack' });
  }

  async parseEvent(req: IncomingRequest): Promise<TriggerEvent | null> {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object') {
      this.logger.warn('Received empty or non-object body');
      return null;
    }

    // Handle URL verification challenge
    if (body.type === 'url_verification') {
      this.logger.info('Received Slack URL verification challenge');
      return createTriggerEvent(
        'slack',
        'url_verification',
        {},
        { challenge: body.challenge },
        body,
      );
    }

    // Slack Events API wrapper
    if (body.type === 'event_callback') {
      const event = body.event as Record<string, unknown> | undefined;
      if (!event) {
        this.logger.warn('Missing event in event_callback payload');
        return null;
      }

      const eventType = event.type as string ?? 'unknown';
      const text = event.text as string | undefined;
      const user = event.user as string | undefined;
      const channel = event.channel as string | undefined;
      const threadTs = event.thread_ts as string | undefined;
      const ts = event.ts as string | undefined;

      // Skip bot messages to avoid loops
      if (event.bot_id || event.subtype === 'bot_message') {
        this.logger.debug('Skipping bot message');
        return null;
      }

      const source: TriggerEventSource = {
        author: user ?? undefined,
        channel: channel ?? undefined,
      };

      const payload: Record<string, unknown> = {
        eventType,
        text,
        user,
        channel,
        threadTs: threadTs ?? ts,
        ts,
        teamId: body.team_id,
        apiAppId: body.api_app_id,
      };

      // app_mention specific fields
      if (eventType === 'app_mention') {
        payload.isMention = true;
      }

      this.logger.info(`Parsed Slack event: ${eventType}`);

      return createTriggerEvent('slack', eventType, source, payload, body);
    }

    // Slack interactive payload (block actions, etc.)
    if (body.type === 'block_actions' || body.type === 'interactive_message') {
      const user = body.user as Record<string, unknown> | undefined;
      const channel = body.channel as Record<string, unknown> | undefined;

      const source: TriggerEventSource = {
        author: (user?.id as string) ?? undefined,
        channel: (channel?.id as string) ?? undefined,
      };

      const payload: Record<string, unknown> = {
        eventType: body.type as string,
        actions: body.actions,
        triggerId: body.trigger_id,
        responseUrl: body.response_url,
        user,
        channel,
      };

      this.logger.info(`Parsed Slack interactive event: ${body.type}`);

      return createTriggerEvent('slack', body.type as string, source, payload, body);
    }

    this.logger.warn(`Unrecognized Slack event type: ${body.type}`);
    return null;
  }

  verifySignature(req: IncomingRequest, secret: string): boolean {
    // Slack signing secret verification
    // Signature header: X-Slack-Signature = "v0=" + hmac-sha256("v0:{timestamp}:{body}", secret)
    const signature = req.headers['x-slack-signature'] as string | undefined;
    const timestamp = req.headers['x-slack-request-timestamp'] as string | undefined;

    if (!signature || !timestamp) {
      this.logger.warn('Missing X-Slack-Signature or X-Slack-Request-Timestamp header');
      return false;
    }

    // Guard against replay attacks (reject requests older than 5 minutes)
    const now = Math.floor(Date.now() / 1000);
    const requestTime = parseInt(timestamp, 10);
    if (isNaN(requestTime) || Math.abs(now - requestTime) > 300) {
      this.logger.warn('Slack request timestamp too old or invalid');
      return false;
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      this.logger.warn('Missing rawBody for Slack signature verification');
      return false;
    }

    const sigBaseString = `v0:${timestamp}:${rawBody.toString('utf-8')}`;
    const expected = 'v0=' + createHmac('sha256', secret)
      .update(sigBaseString)
      .digest('hex');

    try {
      const sigBuf = Buffer.from(signature);
      const expectedBuf = Buffer.from(expected);
      if (sigBuf.length !== expectedBuf.length) return false;
      return timingSafeEqual(sigBuf, expectedBuf);
    } catch {
      return false;
    }
  }

  async sendNotification(target: NotificationTarget, message: NotificationMessage): Promise<void> {
    const webhookUrl = target.webhookUrl;
    if (!webhookUrl) {
      throw new Error('Slack webhook URL not configured');
    }

    this.logger.info('Sending notification to Slack webhook');

    const title = message.title ?? 'Notification';
    const levelEmojiMap: Record<string, string> = {
      info: ':information_source:',
      success: ':white_check_mark:',
      warning: ':warning:',
      error: ':x:',
    };

    const emoji = levelEmojiMap[message.level] ?? ':bell:';

    // Build Slack blocks
    const blocks: Array<Record<string, unknown>> = [];

    // Header
    blocks.push({
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${emoji} ${title}`,
        emoji: true,
      },
    });

    // Content as markdown section
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: message.content,
      },
    });

    // Fields
    if (message.fields?.length) {
      const fieldElements = message.fields.map((field) => ({
        type: 'mrkdwn',
        text: `*${field.label}:* ${field.value}`,
      }));

      // Slack allows max 10 fields per section
      for (let i = 0; i < fieldElements.length; i += 10) {
        blocks.push({
          type: 'section',
          fields: fieldElements.slice(i, i + 10),
        });
      }
    }

    // Actions
    if (message.actions?.length) {
      const actionElements = message.actions.map((action) => ({
        type: 'button',
        text: {
          type: 'plain_text',
          text: action.label,
        },
        url: action.url,
        ...(action.style === 'danger' ? { style: 'danger' } : action.style === 'primary' ? { style: 'primary' } : {}),
      }));
      blocks.push({
        type: 'actions',
        elements: actionElements,
      });
    }

    // Divider at the end
    blocks.push({ type: 'divider' });

    const body = {
      blocks,
      text: `${title}: ${message.content}`, // Fallback for notifications
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Slack webhook error: ${response.status} ${text}`);
    }
  }
}
