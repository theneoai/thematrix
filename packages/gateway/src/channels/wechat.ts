/**
 * WeChat Work (企业微信) Channel Adapter
 *
 * Handles WeChat Work bot callback events and normalizes them into TriggerEvents.
 * Supports: text messages, image messages, event callbacks
 */

import { createHash } from 'node:crypto';
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

export class WeChatChannelAdapter implements ChannelAdapter {
  readonly platform = 'wechat' as const;
  private readonly logger: Logger;

  constructor(config?: Record<string, unknown>) {
    this.logger = new Logger({ prefix: 'gateway:wechat' });
  }

  async parseEvent(req: IncomingRequest): Promise<TriggerEvent | null> {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object') {
      this.logger.warn('Received empty or non-object body');
      return null;
    }

    // WeChat Work callback URL verification
    if (req.query?.echostr) {
      this.logger.info('Received WeChat URL verification');
      return createTriggerEvent(
        'wechat',
        'url_verification',
        {},
        { echostr: req.query.echostr },
        body,
      );
    }

    const msgType = (body.MsgType as string) ?? (body.msgtype as string);
    const eventType = msgType
      ? (body.Event ? `${msgType}.${body.Event}` : msgType)
      : 'unknown';

    const source = this.extractSource(body);
    const payload = this.extractPayload(eventType, body);

    this.logger.info(`Parsed WeChat event: ${eventType}`);

    return createTriggerEvent('wechat', eventType, source, payload, body);
  }

  verifySignature(req: IncomingRequest, secret: string): boolean {
    // WeChat Work signature verification:
    // Sort token, timestamp, nonce alphabetically, concatenate, and SHA1 hash
    const timestamp = (req.query?.timestamp as string) ?? (req.headers['timestamp'] as string);
    const nonce = (req.query?.nonce as string) ?? (req.headers['nonce'] as string);
    const msgSignature = (req.query?.msg_signature as string) ?? (req.headers['msg_signature'] as string);

    if (!timestamp || !nonce || !msgSignature) {
      this.logger.warn('Missing timestamp, nonce, or msg_signature for verification');
      return false;
    }

    const params = [secret, timestamp, nonce].sort();
    const computed = createHash('sha1').update(params.join('')).digest('hex');

    return computed === msgSignature;
  }

  async sendNotification(target: NotificationTarget, message: NotificationMessage): Promise<void> {
    const webhookUrl = target.webhookUrl;
    if (!webhookUrl) {
      throw new Error('WeChat Work webhook URL not configured');
    }

    this.logger.info('Sending notification to WeChat Work webhook');

    const body = this.buildWeChatMessage(message);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`WeChat Work webhook error: ${response.status} ${text}`);
    }

    const result = await response.json() as Record<string, unknown>;
    if (result.errcode !== 0) {
      throw new Error(`WeChat Work webhook returned error: ${result.errmsg}`);
    }
  }

  private extractSource(body: Record<string, unknown>): TriggerEventSource {
    return {
      author: (body.FromUserName as string) ?? (body.from_user as string) ?? undefined,
      channel: (body.ChatId as string) ?? (body.chat_id as string) ?? undefined,
    };
  }

  private extractPayload(eventType: string, body: Record<string, unknown>): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      eventType,
      msgId: body.MsgId ?? body.msgid,
      createTime: body.CreateTime ?? body.create_time,
      fromUser: body.FromUserName ?? body.from_user,
      chatId: body.ChatId ?? body.chat_id,
      chatType: body.ChatType ?? body.chat_type,
    };

    // Extract message content based on type
    const msgType = (body.MsgType as string) ?? (body.msgtype as string);
    switch (msgType) {
      case 'text':
        payload.content = (body.Content as string)
          ?? (body.text as Record<string, unknown>)?.content
          ?? undefined;
        break;

      case 'image':
        payload.picUrl = body.PicUrl ?? (body.image as Record<string, unknown>)?.url;
        payload.mediaId = body.MediaId ?? (body.image as Record<string, unknown>)?.media_id;
        break;

      case 'event': {
        payload.event = body.Event;
        payload.eventKey = body.EventKey;
        break;
      }

      case 'attachment': {
        const attachment = body.attachment as Record<string, unknown> | undefined;
        payload.callbackId = attachment?.callback_id;
        payload.actions = attachment?.actions;
        break;
      }

      default:
        // Pass through unknown types
        payload.rawContent = body;
        break;
    }

    // Handle mentioned users
    if (body.mentioned_list) {
      payload.mentionedList = body.mentioned_list;
    }

    return payload;
  }

  private buildWeChatMessage(message: NotificationMessage): Record<string, unknown> {
    const levelEmoji: Record<string, string> = {
      info: 'INFO',
      success: 'SUCCESS',
      warning: 'WARNING',
      error: 'ERROR',
    };

    const parts: string[] = [];

    if (message.title) {
      parts.push(`**[${levelEmoji[message.level]}] ${message.title}**`);
    }
    parts.push(message.content);

    if (message.fields?.length) {
      parts.push('');
      for (const field of message.fields) {
        parts.push(`> ${field.label}: <font color="info">${field.value}</font>`);
      }
    }

    if (message.actions?.length) {
      parts.push('');
      for (const action of message.actions) {
        parts.push(`[${action.label}](${action.url})`);
      }
    }

    return {
      msgtype: 'markdown',
      markdown: {
        content: parts.join('\n'),
      },
    };
  }
}
