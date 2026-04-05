/**
 * ID 生成工具
 */
import { ulid } from 'ulidx';

export function generateId(): string {
  return ulid();
}

export function generateAgentInstanceId(): string {
  return `agent-${ulid()}`;
}

export function generateWorkflowRunId(): string {
  return `wf-${ulid()}`;
}

export function generateEventId(): string {
  return `evt-${ulid()}`;
}

export function generateMessageId(): string {
  return `msg-${ulid()}`;
}
