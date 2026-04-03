/**
 * Message Broker - 消息代理实现
 */
import type { 
  AgentMessage, 
  IMessageBroker, 
  MessageHandler,
  MessageType,
  MessagePriority,
  Unsubscribe 
} from '@thematrix/types';
import { Logger, generateMessageId } from '@thematrix/utils';
import { EventEmitter } from 'events';

const logger = new Logger({ prefix: 'MessageBroker' });

interface PendingRequest {
  resolve: (value: AgentMessage) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
}

export class MessageBroker implements IMessageBroker {
  private emitter = new EventEmitter();
  private pendingRequests = new Map<string, PendingRequest>();

  constructor() {
    this.emitter.setMaxListeners(1000);
  }

  async send(message: AgentMessage): Promise<void> {
    const channel = this.getChannel(message.toAgentId, message.workflowRunId);
    this.emitter.emit(channel, message);
    
    // Also emit to broadcast channel if needed
    if (message.toAgentId === '*') {
      this.emitter.emit(`broadcast:${message.workflowRunId}`, message);
    }
    
    logger.debug(`Sent message ${message.messageId} to ${message.toAgentId}`);
  }

  async *receive(agentId: string, workflowRunId: string): AsyncIterable<AgentMessage> {
    const channel = this.getChannel(agentId, workflowRunId);
    const messages: AgentMessage[] = [];
    let resolveNext: ((value: IteratorResult<AgentMessage>) => void) | null = null;

    const handler = (message: AgentMessage) => {
      if (resolveNext) {
        resolveNext({ value: message, done: false });
        resolveNext = null;
      } else {
        messages.push(message);
      }
    };

    this.emitter.on(channel, handler);

    try {
      while (true) {
        if (messages.length > 0) {
          yield messages.shift()!;
        } else {
          const message = await new Promise<IteratorResult<AgentMessage>>((resolve) => {
            resolveNext = resolve;
          });
          if (message.done) break;
          yield message.value;
        }
      }
    } finally {
      this.emitter.off(channel, handler);
    }
  }

  async request(message: AgentMessage, timeoutMs: number = 30000): Promise<AgentMessage> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(message.messageId);
        reject(new Error(`Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(message.messageId, { resolve, reject, timeout });

      // Set up reply handler
      const replyChannel = `reply:${message.messageId}`;
      const handler = (reply: AgentMessage) => {
        const pending = this.pendingRequests.get(message.messageId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(message.messageId);
          this.emitter.off(replyChannel, handler);
          pending.resolve(reply);
        }
      };

      this.emitter.once(replyChannel, handler);

      // Send the request
      this.send(message).catch((error) => {
        clearTimeout(timeout);
        this.pendingRequests.delete(message.messageId);
        this.emitter.off(replyChannel, handler);
        reject(error);
      });
    });
  }

  subscribe(channel: string, handler: MessageHandler): Unsubscribe {
    const wrappedHandler = (message: AgentMessage) => {
      try {
        handler(message);
      } catch (error) {
        logger.error(`Error in message handler for ${channel}:`, error);
      }
    };

    this.emitter.on(channel, wrappedHandler);
    logger.debug(`Subscribed to channel: ${channel}`);

    return () => {
      this.emitter.off(channel, wrappedHandler);
      logger.debug(`Unsubscribed from channel: ${channel}`);
    };
  }

  private getChannel(agentId: string, workflowRunId: string): string {
    return `msg:${workflowRunId}:${agentId}`;
  }

  createMessage(
    fromAgentId: string,
    toAgentId: string | '*',
    workflowRunId: string,
    type: MessageType,
    content: AgentMessage['content'],
    options: {
      priority?: MessagePriority;
      replyTo?: string;
    } = {}
  ): AgentMessage {
    return {
      messageId: generateMessageId(),
      fromAgentId,
      toAgentId,
      workflowRunId,
      type,
      content,
      priority: options.priority ?? 'normal',
      timestamp: new Date(),
      replyTo: options.replyTo,
    };
  }
}
