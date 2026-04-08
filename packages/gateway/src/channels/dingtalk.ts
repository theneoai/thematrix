/**
 * DingTalk Channel Adapter
 *
 * Handles DingTalk robot callback events (text messages, interactive cards)
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

export class DingTalkChannelAdapter implements ChannelAdapter {
  readonly platform = 'dingtalk' as const;
  private readonly logger: Logger;

  constructor(config?: Record<string, unknown>) {
    this.logger = new Logger({ prefix: 'gateway:dingtalk' });
  }

  async parseEvent(req: IncomingRequest): Promise<TriggerEvent | null> {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object') {
      this.logger.warn('Received empty or non-object body');
      return null;
    }

    // DingTalk robot callback format
    const msgtype = body.msgtype as string | undefined;
    const conversationType = body.conversationType as string | undefined;
    const conversationId = body.conversationId as string | undefined;
    const senderId = body.senderId as string | undefined;
    const senderNick = body.senderNick as string | undefined;

    // Determine event type
    let eventType = 'message';
    if (msgtype === 'actionCard' || body.actionCardCallback) {
      eventType = 'interactive_card';
    } else if (msgtype) {
      eventType = `message.${msgtype}`;
    }

    const source: TriggerEventSource = {
      author: senderId ?? undefined,
      channel: conversationId ?? undefined,
    };

    const payload: Record<string, unknown> = {
      eventType,
      msgtype,
      conversationType,
      conversationId,
      senderId,
      senderNick,
      sessionWebhook: body.sessionWebhook,
    };

    // Extract text content
    if (msgtype === 'text') {
      const textObj = body.text as Record<string, unknown> | undefined;
      payload.text = textObj?.content ?? '';
      payload.content = textObj?.content ?? '';
    } else if (msgtype === 'richText') {
      payload.richText = body.richText;
    }

    // Handle @mentions
    const atUsers = body.atUsers as Array<Record<string, unknown>> | undefined;
    if (atUsers?.length) {
      payload.atUsers = atUsers;
      payload.mentions = atUsers.map((u) => ({
        id: u.dingtalkId,
        staffId: u.staffId,
      }));
    }

    // Interactive card callback
    if (eventType === 'interactive_card') {
      payload.actionCardCallback = body.actionCardCallback;
      payload.value = (body.actionCardCallback as Record<string, unknown>)?.value;
    }

    this.logger.info(`Parsed DingTalk event: ${eventType}`);

    return createTriggerEvent('dingtalk', eventType, source, payload, body);
  }

  verifySignature(req: IncomingRequest, secret: string): boolean {
    // DingTalk uses timestamp + secret HMAC-SHA256 signature
    // The signature is passed in the query string or header as "sign"
    // timestamp is also passed alongside
    const timestamp = (req.headers['timestamp'] as string)
      ?? (req.query?.timestamp as string | undefined);
    const signature = (req.headers['sign'] as string)
      ?? (req.query?.sign as string | undefined);

    if (!timestamp || !signature) {
      this.logger.warn('Missing timestamp or sign for DingTalk verification');
      return false;
    }

    // Replay protection: reject requests older than 1 hour (DingTalk recommendation)
    const timestampNum = Number(timestamp);
    const now = Date.now();
    if (Number.isNaN(timestampNum) || Math.abs(now - timestampNum) > 3600000) {
      this.logger.warn('Request timestamp is stale or invalid (replay protection)');
      return false;
    }

    // DingTalk signature: Base64(HmacSHA256(timestamp + "\n" + secret, secret))
    const stringToSign = `${timestamp}\n${secret}`;
    const expected = createHmac('sha256', secret)
      .update(stringToSign)
      .digest('base64');

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
      throw new Error('DingTalk webhook URL not configured');
    }

    this.logger.info('Sending notification to DingTalk webhook');

    // Build markdown message
    const title = message.title ?? 'Notification';
    let markdownText = `## ${title}\n\n${message.content}`;

    if (message.fields?.length) {
      markdownText += '\n\n';
      for (const field of message.fields) {
        markdownText += `**${field.label}:** ${field.value}\n\n`;
      }
    }

    if (message.actions?.length) {
      markdownText += '\n\n';
      for (const action of message.actions) {
        markdownText += `[${action.label}](${action.url}) `;
      }
    }

    const body: Record<string, unknown> = {
      msgtype: 'markdown',
      markdown: {
        title,
        text: markdownText,
      },
    };

    // If a signing secret is provided, add timestamp + sign to URL
    const signingSecret = target.config?.signingSecret as string | undefined;
    let url = webhookUrl;
    if (signingSecret) {
      const timestamp = Date.now().toString();
      const stringToSign = `${timestamp}\n${signingSecret}`;
      const sign = createHmac('sha256', signingSecret)
        .update(stringToSign)
        .digest('base64');
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`DingTalk webhook error: ${response.status} ${text}`);
    }

    const result = await response.json() as Record<string, unknown>;
    if (result.errcode !== 0) {
      throw new Error(`DingTalk webhook returned error: ${result.errmsg}`);
    }
  }
}
