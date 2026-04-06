/**
 * A2A Client - 连接远端 Agent, 支持任务委托和状态订阅
 *
 * 实现 Google A2A 协议: JSON-RPC 2.0 + SSE streaming
 */
import type {
  AgentCard,
  A2ASendTaskRequest,
  A2ASendTaskResponse,
  A2ATask,
  A2ATaskEvent,
  IA2AClient,
} from '@thematrix/types';
import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'A2AClient' });

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_SSE_IDLE_TIMEOUT_MS = 120_000;

export class A2AClient implements IA2AClient {
  private readonly timeoutMs: number;
  private readonly headers: Record<string, string>;
  private nextRequestId = 1;

  /** SSE 流空闲超时 (ms): 超过此时间无事件则断开 */
  private readonly sseIdleTimeoutMs: number;

  constructor(options: { timeoutMs?: number; sseIdleTimeoutMs?: number; headers?: Record<string, string> } = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.sseIdleTimeoutMs = options.sseIdleTimeoutMs ?? DEFAULT_SSE_IDLE_TIMEOUT_MS;
    this.headers = options.headers ?? {};
  }

  /**
   * 发现远端 Agent -- 获取其 Agent Card
   */
  async discover(url: string): Promise<AgentCard> {
    const cardUrl = url.endsWith('/')
      ? `${url}.well-known/agent.json`
      : `${url}/.well-known/agent.json`;

    logger.info(`Discovering agent at ${cardUrl}`);

    const response = await this.fetchWithTimeout(cardUrl, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`Failed to discover agent at ${cardUrl}: ${response.status} ${response.statusText}`);
    }

    const card = (await response.json()) as AgentCard;
    logger.info(`Discovered agent: ${card.name} (${card.id}) with ${card.capabilities.length} capabilities`);
    return card;
  }

  /**
   * 发送任务给远端 Agent
   */
  async sendTask(agentUrl: string, request: A2ASendTaskRequest): Promise<A2ASendTaskResponse> {
    logger.info(`Sending task ${request.taskId} to ${agentUrl}`);

    const response = await this.rpcCall(agentUrl, 'tasks/send', {
      id: request.taskId,
      message: request.message,
      pushNotification: request.pushNotification,
    });

    return response as A2ASendTaskResponse;
  }

  /**
   * 查询任务状态
   */
  async getTask(agentUrl: string, taskId: string): Promise<A2ATask> {
    logger.info(`Getting task ${taskId} from ${agentUrl}`);
    const response = await this.rpcCall(agentUrl, 'tasks/get', { id: taskId });
    return response as A2ATask;
  }

  /**
   * 取消任务
   */
  async cancelTask(agentUrl: string, taskId: string): Promise<A2ATask> {
    logger.info(`Cancelling task ${taskId} at ${agentUrl}`);
    const response = await this.rpcCall(agentUrl, 'tasks/cancel', { id: taskId });
    return response as A2ATask;
  }

  /**
   * 流式订阅任务更新 (SSE)
   */
  async *subscribeTask(agentUrl: string, taskId: string): AsyncIterable<A2ATaskEvent> {
    const rpcRequest = {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'tasks/sendSubscribe',
      params: { id: taskId },
    };

    const response = await this.fetchWithTimeout(agentUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...this.headers,
      },
      body: JSON.stringify(rpcRequest),
    });

    if (!response.ok) {
      throw new Error(`SSE subscription failed: ${response.status}`);
    }

    if (!response.body) {
      throw new Error('No response body for SSE stream');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const resetIdleTimer = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        logger.warn(`SSE idle timeout (${this.sseIdleTimeoutMs}ms) for task ${taskId}, closing stream`);
        reader.cancel().catch(() => {});
      }, this.sseIdleTimeoutMs);
    };

    try {
      resetIdleTimer();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        resetIdleTimer();

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let currentData = '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            currentData += line.slice(6);
          } else if (line === '' && currentData) {
            try {
              const event = JSON.parse(currentData) as A2ATaskEvent;
              yield event;
            } catch {
              logger.warn(`Failed to parse SSE event: ${currentData}`);
            }
            currentData = '';
          }
        }
      }
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      reader.releaseLock();
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private getNextId(): number {
    const id = this.nextRequestId;
    this.nextRequestId = this.nextRequestId >= 2 ** 31 - 1 ? 1 : this.nextRequestId + 1;
    return id;
  }

  private async rpcCall(url: string, method: string, params: Record<string, unknown>): Promise<unknown> {
    const request = {
      jsonrpc: '2.0',
      id: this.getNextId(),
      method,
      params,
    };

    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`A2A RPC error: ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as {
      result?: unknown;
      error?: { code: number; message: string };
    };

    if (json.error) {
      throw new Error(`A2A RPC error ${json.error.code}: ${json.error.message}`);
    }

    return json.result;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
