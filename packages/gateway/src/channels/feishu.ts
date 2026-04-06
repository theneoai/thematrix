/**
 * Feishu (Lark) Channel Adapter
 *
 * Handles Feishu bot events and normalizes them into TriggerEvents.
 * Supports: im.message.receive_v1, card action, URL verification challenge
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
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

export class FeishuChannelAdapter implements ChannelAdapter {
  readonly platform = 'feishu' as const;
  private readonly logger: Logger;

  constructor(config?: Record<string, unknown>) {
    this.logger = new Logger({ prefix: 'gateway:feishu' });
  }

  async parseEvent(req: IncomingRequest): Promise<TriggerEvent | null> {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object') {
      this.logger.warn('Received empty or non-object body');
      return null;
    }

    // Handle URL verification challenge (Feishu event subscription setup)
    if (body.type === 'url_verification') {
      this.logger.info('Received URL verification challenge');
      // Return a special event so the server can respond with the challenge
      return createTriggerEvent(
        'feishu',
        'url_verification',
        {},
        { challenge: body.challenge },
        body,
      );
    }

    // Feishu Event API v2 format
    const header = body.header as Record<string, unknown> | undefined;
    const event = body.event as Record<string, unknown> | undefined;

    const eventType = (header?.event_type as string) ?? (body.event_type as string);
    if (!eventType) {
      this.logger.warn('Missing event_type in header or body');
      return null;
    }

    const source = this.extractSource(eventType, event ?? body);
    const payload = this.extractPayload(eventType, event ?? body, header);

    this.logger.info(`Parsed Feishu event: ${eventType}`);

    return createTriggerEvent('feishu', eventType, source, payload, body);
  }

  verifySignature(req: IncomingRequest, secret: string): boolean {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body) return false;

    // Feishu Event API v2 uses timestamp + nonce + encrypt verification
    const timestamp = (req.headers['x-lark-request-timestamp'] as string)
      ?? (body.header as Record<string, unknown>)?.create_time as string | undefined;
    const nonce = (req.headers['x-lark-request-nonce'] as string) ?? '';
    const signature = req.headers['x-lark-signature'] as string | undefined;

    if (!signature || !timestamp) {
      this.logger.warn('Missing signature or timestamp for verification');
      return false;
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      this.logger.warn('Missing rawBody for signature verification');
      return false;
    }

    // Feishu signature: sha256(timestamp + "\n" + nonce + "\n" + secret + "\n" + body)
    const content = `${timestamp}\n${nonce}\n${secret}\n${rawBody.toString('utf-8')}`;
    const expected = createHash('sha256').update(content).digest('hex');

    // Use timing-safe comparison to prevent timing attacks
    try {
      return timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expected, 'hex'),
      );
    } catch {
      return false;
    }
  }

  async sendNotification(target: NotificationTarget, message: NotificationMessage): Promise<void> {
    const webhookUrl = target.webhookUrl;
    if (!webhookUrl) {
      throw new Error('Feishu webhook URL not configured');
    }

    const card = this.buildFeishuCard(message);

    this.logger.info('Sending notification to Feishu webhook');

    const body: Record<string, unknown> = {
      msg_type: 'interactive',
      card,
    };

    // If a signing secret is provided, add signature
    const signingSecret = target.config?.signingSecret as string | undefined;
    if (signingSecret) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const stringToSign = `${timestamp}\n${signingSecret}`;
      const sign = createHmac('sha256', Buffer.from(stringToSign, 'utf-8')).update('').digest('base64');
      body.timestamp = timestamp;
      body.sign = sign;
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Feishu webhook error: ${response.status} ${text}`);
    }

    const result = await response.json() as Record<string, unknown>;
    if (result.code !== 0) {
      throw new Error(`Feishu webhook returned error: ${result.msg}`);
    }
  }

  private extractSource(eventType: string, event: Record<string, unknown>): TriggerEventSource {
    const message = event.message as Record<string, unknown> | undefined;
    const sender = event.sender as Record<string, unknown> | undefined;
    const senderId = sender?.sender_id as Record<string, unknown> | undefined;

    return {
      author: (sender?.sender_id as Record<string, unknown>)?.open_id as string
        ?? senderId?.user_id as string
        ?? undefined,
      channel: message?.chat_id as string ?? undefined,
    };
  }

  private extractPayload(
    eventType: string,
    event: Record<string, unknown>,
    header?: Record<string, unknown>,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      eventType,
      appId: header?.app_id,
      tenantKey: header?.tenant_key,
    };

    switch (eventType) {
      case 'im.message.receive_v1': {
        const message = event.message as Record<string, unknown> | undefined;
        const sender = event.sender as Record<string, unknown> | undefined;
        const senderId = sender?.sender_id as Record<string, unknown> | undefined;

        payload.messageId = message?.message_id;
        payload.messageType = message?.message_type;
        payload.chatId = message?.chat_id;
        payload.chatType = message?.chat_type;
        payload.senderOpenId = senderId?.open_id;
        payload.senderUserId = senderId?.user_id;

        // Parse message content (it's a JSON string)
        const content = message?.content as string | undefined;
        if (content) {
          try {
            const parsed = JSON.parse(content);
            payload.text = parsed.text;
            payload.messageContent = parsed;
          } catch {
            payload.text = content;
          }
        }

        // Handle @mentions
        const mentions = message?.mentions as Array<Record<string, unknown>> | undefined;
        if (mentions?.length) {
          payload.mentions = mentions.map((m) => ({
            key: m.key,
            id: (m.id as Record<string, unknown>)?.open_id ?? m.id,
            name: m.name,
          }));
        }
        break;
      }

      case 'card.action.trigger': {
        payload.action = event.action as Record<string, unknown> | undefined;
        payload.operator = event.operator as Record<string, unknown> | undefined;
        payload.token = event.token;
        break;
      }

      default: {
        // For unknown event types, pass through the event data
        payload.eventData = event;
        break;
      }
    }

    return payload;
  }

  private buildFeishuCard(message: NotificationMessage): Record<string, unknown> {
    const levelColorMap: Record<string, string> = {
      info: 'blue',
      success: 'green',
      warning: 'orange',
      error: 'red',
    };

    const elements: Array<Record<string, unknown>> = [];

    // Content
    elements.push({
      tag: 'markdown',
      content: message.content,
    });

    // Fields
    if (message.fields?.length) {
      const fieldElements = message.fields.map((field) => ({
        is_short: field.inline ?? false,
        text: {
          tag: 'lark_md',
          content: `**${field.label}:** ${field.value}`,
        },
      }));
      elements.push({
        tag: 'div',
        fields: fieldElements,
      });
    }

    // Actions
    if (message.actions?.length) {
      const actionElements = message.actions.map((action) => ({
        tag: 'button',
        text: { tag: 'plain_text', content: action.label },
        url: action.url,
        type: action.style === 'danger' ? 'danger' : action.style === 'primary' ? 'primary' : 'default',
      }));
      elements.push({
        tag: 'action',
        actions: actionElements,
      });
    }

    return {
      header: {
        title: {
          tag: 'plain_text',
          content: message.title ?? 'Notification',
        },
        template: levelColorMap[message.level] ?? 'blue',
      },
      elements,
    };
  }
}
