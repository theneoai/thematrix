/**
 * Message 类型定义
 */

export type MessageType = 'request' | 'response' | 'notification' | 'command';
export type MessagePriority = 'low' | 'normal' | 'high' | 'critical';

export type MessageContent = 
  | TextContent 
  | StructuredContent 
  | ToolResultContent 
  | HandoffContent;

export interface TextContent {
  type: 'text';
  text: string;
}

export interface StructuredContent {
  type: 'structured';
  data: Record<string, unknown>;
}

export interface ToolResultContent {
  type: 'tool-result';
  toolName: string;
  result: unknown;
  error?: string;
}

export interface HandoffContent {
  type: 'handoff';
  toAgentId: string;
  context: Record<string, unknown>;
}

export interface AgentMessage {
  messageId: string;
  fromAgentId: string;
  toAgentId: string | '*';
  workflowRunId: string;
  type: MessageType;
  content: MessageContent;
  priority: MessagePriority;
  timestamp: Date;
  replyTo?: string;
}

export type MessageHandler = (message: AgentMessage) => void | Promise<void>;

export interface IMessageBroker {
  send(message: AgentMessage): Promise<void>;
  receive(agentId: string, workflowRunId: string): AsyncIterable<AgentMessage>;
  request(message: AgentMessage, timeoutMs?: number): Promise<AgentMessage>;
  subscribe(channel: string, handler: MessageHandler): Unsubscribe;
}

// Unsubscribe type imported from event.ts
import type { Unsubscribe } from './event.js';
export type { Unsubscribe };
