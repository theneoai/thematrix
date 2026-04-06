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
}

export class A2AServer implements IA2AServer {
  private readonly config: A2AServerConfig;
  private readonly registry: AgentRegistry;
  private readonly tasks = new Map<string, A2ATask>();
  private readonly sseClients = new Map<string, Set<ServerResponse>>();
  private taskHandler?: A2ATaskHandler;
  private server: Server | null = null;

  constructor(config: A2AServerConfig, registry?: AgentRegistry) {
    this.config = config;
    this.registry = registry ?? new AgentRegistry();
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
    return new Promise((resolve) => {
      this.server = createServer((req, res) => {
        void this.handleRequest(req, res);
      });

      this.server.listen(this.config.port, this.config.host ?? '0.0.0.0', () => {
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
    const body = await readBody(req);

    let parsed: { jsonrpc: string; id?: number; method: string; params?: Record<string, unknown> };
    try {
      parsed = JSON.parse(body);
    } catch {
      this.sendJsonRpcError(res, null, -32700, 'Parse error');
      return;
    }

    const { id, method, params } = parsed;

    try {
      switch (method) {
        case 'tasks/send':
          return this.handleTaskSend(res, id ?? 0, params ?? {});
        case 'tasks/get':
          return this.handleTaskGet(res, id ?? 0, params ?? {});
        case 'tasks/cancel':
          return this.handleTaskCancel(res, id ?? 0, params ?? {});
        case 'tasks/sendSubscribe':
          return this.handleTaskSubscribe(res, id ?? 0, params ?? {});
        default:
          this.sendJsonRpcError(res, id ?? null, -32601, `Method not found: ${method}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.sendJsonRpcError(res, id ?? null, -32603, message);
    }
  }

  private handleTaskSend(res: ServerResponse, id: number, params: Record<string, unknown>): void {
    const taskId = (params.id as string) ?? generateId();
    const message = params.message as A2AMessage;

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

    // Notify SSE subscribers
    this.notifySubscribers(taskId, { type: 'status-update', taskId, status: 'working' });

    // Execute task asynchronously via handler
    if (this.taskHandler) {
      void this.taskHandler(task).then((updatedTask) => {
        this.tasks.set(taskId, updatedTask);
        this.notifySubscribers(taskId, {
          type: 'status-update',
          taskId,
          status: updatedTask.status,
        });
      }).catch((error) => {
        task!.status = 'failed';
        task!.updatedAt = new Date();
        logger.error(`Task ${taskId} failed: ${error instanceof Error ? error.message : String(error)}`);
        this.notifySubscribers(taskId, { type: 'status-update', taskId, status: 'failed' });
      });
    }

    this.sendJsonRpcResult(res, id, { task });
  }

  private handleTaskGet(res: ServerResponse, id: number, params: Record<string, unknown>): void {
    const taskId = params.id as string;
    const task = this.tasks.get(taskId);

    if (!task) {
      this.sendJsonRpcError(res, id, -32602, `Task not found: ${taskId}`);
      return;
    }

    this.sendJsonRpcResult(res, id, task);
  }

  private handleTaskCancel(res: ServerResponse, id: number, params: Record<string, unknown>): void {
    const taskId = params.id as string;
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
    const taskId = params.id as string;

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

    req_cleanup(res, () => {
      this.sseClients.get(taskId)?.delete(res);
    });
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private notifySubscribers(taskId: string, event: { type: string; taskId: string; status?: A2ATaskStatus; artifact?: A2AArtifact; message?: A2AMessage }): void {
    const clients = this.sseClients.get(taskId);
    if (!clients) return;

    const data = JSON.stringify(event);
    for (const client of clients) {
      client.write(`data: ${data}\n\n`);
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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function req_cleanup(res: ServerResponse, fn: () => void): void {
  res.on('close', fn);
  res.on('error', fn);
}
