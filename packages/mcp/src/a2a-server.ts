/**
 * A2A Server - 将本地 Agent 暴露为 A2A 兼容端点
 *
 * 支持:
 * - Agent Card 发现 (GET /.well-known/agent.json)
 * - 任务接收 (POST /a2a via JSON-RPC)
 * - 任务状态查询
 * - SSE 流式更新
 */
import type {
  AgentCard,
  A2ATask,
  A2ATaskHandler,
  A2ATaskStatus,
  A2AArtifact,
  A2AMessage,
  IA2AServer,
  IAgentRegistry,
} from '@thematrix/types';
import { Logger, generateId } from '@thematrix/utils';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';

const logger = new Logger({ prefix: 'A2AServer' });

/** 请求体大小限制 (1MB) */
const MAX_BODY_SIZE = 1024 * 1024;

export class AgentRegistry implements IAgentRegistry {
  private readonly agents = new Map<string, AgentCard>();

  register(card: AgentCard): void {
    this.agents.set(card.id, card);
    logger.info(`Registered agent: ${card.name} (${card.id})`);
  }

  unregister(agentId: string): void {
    this.agents.delete(agentId);
    logger.info(`Unregistered agent: ${agentId}`);
  }

  getById(agentId: string): AgentCard | undefined {
    return this.agents.get(agentId);
  }

  findByCapability(capabilityName: string): AgentCard[] {
    return Array.from(this.agents.values()).filter((card) =>
      card.capabilities.some((cap) => cap.name === capabilityName),
    );
  }

  listAll(): AgentCard[] {
    return Array.from(this.agents.values());
  }
}

export interface A2AServerConfig {
  port: number;
  host?: string;
  /** 请求体大小限制 (bytes, default: 1MB) */
  maxBodySize?: number;
  /** 已完成任务最大保留数量 (default: 10000) */
  maxTasks?: number;
  /** 已完成任务存活时间 (ms, default: 1h) */
  taskTtlMs?: number;
}

export class A2AServer implements IA2AServer {
  private readonly config: A2AServerConfig;
  private readonly registry: AgentRegistry;
  private readonly tasks = new Map<string, A2ATask>();
  private readonly sseClients = new Map<string, Set<ServerResponse>>();
  private taskHandler?: A2ATaskHandler;
  private server: Server | null = null;
  private readonly maxBodySize: number;
  private readonly maxTasks: number;
  private readonly taskTtlMs: number;

  constructor(config: A2AServerConfig, registry?: AgentRegistry) {
    this.config = config;
    this.registry = registry ?? new AgentRegistry();
    this.maxBodySize = config.maxBodySize ?? MAX_BODY_SIZE;
    this.maxTasks = config.maxTasks ?? 10_000;
    this.taskTtlMs = config.taskTtlMs ?? 3_600_000; // 1 hour
  }

  registerAgent(card: AgentCard): void {
    this.registry.register(card);
  }

  unregisterAgent(agentId: string): void {
    this.registry.unregister(agentId);
  }

  setTaskHandler(handler: A2ATaskHandler): void {
    this.taskHandler = handler;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        void this.handleRequest(req, res);
      });

      const onError = (err: Error): void => {
        logger.error(`Server error: ${err.message}`);
        reject(err);
      };
      this.server.on('error', onError);

      this.server.listen(this.config.port, this.config.host ?? '0.0.0.0', () => {
        // Replace startup error handler with runtime error handler
        this.server!.removeListener('error', onError);
        this.server!.on('error', (err) => {
          logger.error(`A2A Server runtime error: ${err.message}`);
        });
        logger.info(`A2A Server listening on port ${this.config.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    // Close all SSE connections
    for (const clients of this.sseClients.values()) {
      for (const res of clients) {
        res.end();
      }
    }
    this.sseClients.clear();

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('A2A Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  // -----------------------------------------------------------------------
  // Request handling
  // -----------------------------------------------------------------------

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/';

    // Agent Card discovery
    if (req.method === 'GET' && url === '/.well-known/agent.json') {
      return this.handleAgentCardDiscovery(res);
    }

    // A2A JSON-RPC endpoint
    if (req.method === 'POST' && (url === '/' || url === '/a2a')) {
      return this.handleJsonRpc(req, res);
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  private handleAgentCardDiscovery(res: ServerResponse): void {
    const agents = this.registry.listAll();
    if (agents.length === 0) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No agents registered' }));
      return;
    }

    // Return the first registered agent's card (primary agent)
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(agents[0]));
  }

  private async handleJsonRpc(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: string;
    try {
      body = await readBody(req, this.maxBodySize);
    } catch (error) {
      this.sendJsonRpcError(res, null, -32600, error instanceof Error ? error.message : 'Invalid request');
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      this.sendJsonRpcError(res, null, -32700, 'Parse error');
      return;
    }

    const id = typeof parsed.id === 'number' ? parsed.id : 0;
    const method = typeof parsed.method === 'string' ? parsed.method : '';
    const params = (typeof parsed.params === 'object' && parsed.params !== null && !Array.isArray(parsed.params))
      ? parsed.params as Record<string, unknown>
      : {};

    if (!method) {
      this.sendJsonRpcError(res, id, -32600, 'Missing required field: method');
      return;
    }

    try {
      switch (method) {
        case 'tasks/send':
          return this.handleTaskSend(res, id, params);
        case 'tasks/get':
          return this.handleTaskGet(res, id, params);
        case 'tasks/cancel':
          return this.handleTaskCancel(res, id, params);
        case 'tasks/sendSubscribe':
          return this.handleTaskSubscribe(res, id, params);
        default:
          this.sendJsonRpcError(res, id, -32601, `Method not found: ${method}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.sendJsonRpcError(res, id, -32603, message);
    }
  }

  private handleTaskSend(res: ServerResponse, id: number, params: Record<string, unknown>): void {
    const taskId = typeof params.id === 'string' ? params.id : generateId();
    const message = (typeof params.message === 'object' && params.message !== null)
      ? params.message as A2AMessage
      : undefined;

    let task = this.tasks.get(taskId);
    if (!task) {
      task = {
        taskId,
        fromAgentId: '',
        toAgentId: '',
        status: 'submitted',
        messages: [],
        artifacts: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.tasks.set(taskId, task);
    }

    if (message) {
      task.messages.push(message);
    }
    task.status = 'working';
    task.updatedAt = new Date();

    // Evict stale completed tasks if over limit
    this.evictStaleTasks();

    // Notify SSE subscribers
    this.notifySubscribers(taskId, { type: 'status-update', taskId, status: 'working' });

    // Send response immediately (task executes asynchronously)
    this.sendJsonRpcResult(res, id, { task: { ...task } });

    // Execute task asynchronously via handler
    if (this.taskHandler) {
      const currentTask = task;
      void this.taskHandler(currentTask).then((updatedTask) => {
        this.tasks.set(taskId, updatedTask);
        this.notifySubscribers(taskId, {
          type: 'status-update',
          taskId,
          status: updatedTask.status,
        });
      }).catch((error) => {
        currentTask.status = 'failed';
        currentTask.updatedAt = new Date();
        this.tasks.set(taskId, currentTask);
        logger.error(`Task ${taskId} failed: ${error instanceof Error ? error.message : String(error)}`);
        this.notifySubscribers(taskId, { type: 'status-update', taskId, status: 'failed' });
      });
    }
  }

  private handleTaskGet(res: ServerResponse, id: number, params: Record<string, unknown>): void {
    const taskId = typeof params.id === 'string' ? params.id : '';
    if (!taskId) {
      this.sendJsonRpcError(res, id, -32602, 'Missing required parameter: id');
      return;
    }

    const task = this.tasks.get(taskId);
    if (!task) {
      this.sendJsonRpcError(res, id, -32602, `Task not found: ${taskId}`);
      return;
    }

    this.sendJsonRpcResult(res, id, task);
  }

  private handleTaskCancel(res: ServerResponse, id: number, params: Record<string, unknown>): void {
    const taskId = typeof params.id === 'string' ? params.id : '';
    if (!taskId) {
      this.sendJsonRpcError(res, id, -32602, 'Missing required parameter: id');
      return;
    }

    const task = this.tasks.get(taskId);
    if (!task) {
      this.sendJsonRpcError(res, id, -32602, `Task not found: ${taskId}`);
      return;
    }

    task.status = 'cancelled';
    task.updatedAt = new Date();
    this.notifySubscribers(taskId, { type: 'status-update', taskId, status: 'cancelled' });

    this.sendJsonRpcResult(res, id, task);
  }

  private handleTaskSubscribe(res: ServerResponse, _id: number, params: Record<string, unknown>): void {
    const taskId = typeof params.id === 'string' ? params.id : '';
    if (!taskId) {
      this.sendJsonRpcError(res, _id, -32602, 'Missing required parameter: id');
      return;
    }

    // Switch to SSE mode
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    if (!this.sseClients.has(taskId)) {
      this.sseClients.set(taskId, new Set());
    }
    this.sseClients.get(taskId)!.add(res);

    // Send current state
    const task = this.tasks.get(taskId);
    if (task) {
      res.write(`data: ${JSON.stringify({ type: 'status-update', taskId, status: task.status })}\n\n`);
    }

    // Cleanup on disconnect: remove client, and delete empty Set to prevent leak
    const cleanup = (): void => {
      const clients = this.sseClients.get(taskId);
      if (clients) {
        clients.delete(res);
        if (clients.size === 0) {
          this.sseClients.delete(taskId);
        }
      }
    };
    res.on('close', cleanup);
    res.on('error', cleanup);
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private evictStaleTasks(): void {
    if (this.tasks.size <= this.maxTasks) return;

    const now = Date.now();
    const terminalStatuses: Set<A2ATaskStatus> = new Set(['completed', 'failed', 'cancelled']);

    // First pass: remove expired terminal tasks
    for (const [id, task] of this.tasks) {
      if (terminalStatuses.has(task.status) && now - task.updatedAt.getTime() > this.taskTtlMs) {
        this.tasks.delete(id);
        this.sseClients.delete(id);
      }
    }

    // Second pass: if still over limit, remove oldest terminal tasks
    if (this.tasks.size > this.maxTasks) {
      const terminalEntries = Array.from(this.tasks.entries())
        .filter(([, t]) => terminalStatuses.has(t.status))
        .sort(([, a], [, b]) => a.updatedAt.getTime() - b.updatedAt.getTime());

      const toRemove = this.tasks.size - this.maxTasks;
      for (let i = 0; i < Math.min(toRemove, terminalEntries.length); i++) {
        this.tasks.delete(terminalEntries[i][0]);
        this.sseClients.delete(terminalEntries[i][0]);
      }
    }
  }

  private notifySubscribers(taskId: string, event: { type: string; taskId: string; status?: A2ATaskStatus; artifact?: A2AArtifact; message?: A2AMessage }): void {
    const clients = this.sseClients.get(taskId);
    if (!clients) return;

    const data = JSON.stringify(event);
    for (const client of clients) {
      try {
        client.write(`data: ${data}\n\n`);
      } catch {
        // Client disconnected; remove on next cleanup cycle
        clients.delete(client);
      }
    }
  }

  private sendJsonRpcResult(res: ServerResponse, id: number, result: unknown): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
  }

  private sendJsonRpcError(res: ServerResponse, id: number | null, code: number, message: string): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }));
  }
}

// -----------------------------------------------------------------------
// Utility functions
// -----------------------------------------------------------------------

function readBody(req: IncomingMessage, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;

    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > maxSize) {
        req.destroy();
        reject(new Error(`Request body exceeds maximum size of ${maxSize} bytes`));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}
