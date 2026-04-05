/**
 * MCP Client - Connects to external MCP servers to use their tools
 */
import type {
  MCPClientConfig,
  MCPTool,
  MCPToolCall,
  MCPToolResult,
  IMCPClient,
} from '@thematrix/types';
import { Logger } from '@thematrix/utils';
import { spawn, type ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';

const logger = new Logger({ prefix: 'MCPClient' });

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};

export class MCPClient implements IMCPClient {
  private config: MCPClientConfig;
  private connected = false;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private static readonly MAX_REQUEST_ID = 2 ** 31 - 1;
  private static readonly REQUEST_TIMEOUT_MS = 30_000;

  // stdio transport state
  private childProcess: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private stderrRl: readline.Interface | null = null;

  constructor(config: MCPClientConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      throw new Error('Already connected');
    }

    const transport = this.config.transport;

    if (transport.type === 'stdio') {
      await this.connectStdio(transport.command, transport.args ?? [], transport.env);
    } else {
      await this.connectHttp();
    }

    this.connected = true;
    logger.info(`Connected to MCP server "${this.config.name}"`);
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    this.connected = false;
    this.rejectAllPending(new Error('Client disconnected'));

    if (this.stderrRl) {
      this.stderrRl.close();
      this.stderrRl = null;
    }

    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    if (this.childProcess) {
      this.childProcess.kill('SIGTERM');
      this.childProcess = null;
    }

    logger.info(`Disconnected from MCP server "${this.config.name}"`);
  }

  async listTools(): Promise<MCPTool[]> {
    const result = (await this.sendRequest('tools/list', {})) as {
      tools: MCPTool[];
    };
    return result.tools;
  }

  async callTool(call: MCPToolCall): Promise<MCPToolResult> {
    const result = (await this.sendRequest('tools/call', {
      name: call.name,
      arguments: call.arguments,
    })) as MCPToolResult;
    return result;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private async connectStdio(
    command: string,
    args: string[],
    env?: Record<string, string>,
  ): Promise<void> {
    this.childProcess = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });

    this.childProcess.on('error', (error) => {
      logger.error(`Child process error: ${error.message}`);
      this.connected = false;
      this.rejectAllPending(new Error(`Child process error: ${error.message}`));
    });

    this.childProcess.on('exit', (code) => {
      logger.info(`Child process exited with code ${code}`);
      this.connected = false;
      this.rejectAllPending(new Error(`Child process exited with code ${code}`));
    });

    // Pipe stderr to our logger
    if (this.childProcess.stderr) {
      this.stderrRl = readline.createInterface({ input: this.childProcess.stderr });
      this.stderrRl.on('line', (line: string) => {
        logger.warn(`[server stderr] ${line}`);
      });
    }

    // Set up JSON-RPC line reader on stdout
    if (!this.childProcess.stdout) {
      throw new Error('Failed to get stdout from child process');
    }

    this.rl = readline.createInterface({
      input: this.childProcess.stdout,
      terminal: false,
    });

    this.rl.on('line', (line: string) => {
      this.handleResponseLine(line);
    });

    // Send initialize request
    const initResult = (await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'thematrix',
        version: '0.1.0',
      },
    })) as Record<string, unknown>;

    logger.info(`Server initialized: ${JSON.stringify(initResult.serverInfo)}`);

    // Send initialized notification
    this.sendNotification('notifications/initialized', {});
  }

  private async connectHttp(): Promise<void> {
    const transport = this.config.transport;
    if (transport.type !== 'http') {
      throw new Error('Expected HTTP transport config');
    }

    // Send initialize request via HTTP
    const initResult = (await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'thematrix',
        version: '0.1.0',
      },
    })) as Record<string, unknown>;

    logger.info(`Server initialized: ${JSON.stringify(initResult.serverInfo)}`);
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private getNextId(): number {
    const id = this.nextId;
    this.nextId = this.nextId >= MCPClient.MAX_REQUEST_ID ? 1 : this.nextId + 1;
    return id;
  }

  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.getNextId();
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const transport = this.config.transport;

    if (transport.type === 'http') {
      return this.sendHttpRequest(request);
    }

    return new Promise<unknown>((resolve, reject) => {
      // Set a timeout for pending requests
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Request ${method} (id: ${id}) timed out after ${MCPClient.REQUEST_TIMEOUT_MS}ms`));
        }
      }, MCPClient.REQUEST_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });

      try {
        this.writeToStdin(request);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  private sendNotification(method: string, params: Record<string, unknown>): void {
    const message = {
      jsonrpc: '2.0' as const,
      method,
      params,
    };

    if (this.config.transport.type === 'stdio') {
      this.writeToStdin(message);
    }
    // HTTP transport: fire-and-forget POST (no response expected)
  }

  private writeToStdin(message: object): void {
    if (!this.childProcess?.stdin) {
      throw new Error('No stdin available');
    }

    const line = JSON.stringify(message) + '\n';
    this.childProcess.stdin.write(line);
  }

  private handleResponseLine(line: string): void {
    if (!line.trim()) return;

    try {
      const response = JSON.parse(line) as JsonRpcResponse;

      if (response.id === null || response.id === undefined) {
        // Notification from server, ignore
        return;
      }

      const pending = this.pending.get(response.id);
      if (!pending) {
        logger.warn(`Received response for unknown request id: ${response.id}`);
        return;
      }

      this.pending.delete(response.id);

      if (response.error) {
        pending.reject(
          new Error(`JSON-RPC error ${response.error.code}: ${response.error.message}`),
        );
      } else {
        pending.resolve(response.result);
      }
    } catch {
      logger.warn(`Failed to parse response line: ${line}`);
    }
  }

  private async sendHttpRequest(request: JsonRpcRequest): Promise<unknown> {
    const transport = this.config.transport;
    if (transport.type !== 'http') {
      throw new Error('Expected HTTP transport');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), MCPClient.REQUEST_TIMEOUT_MS);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...transport.headers,
      };

      const response = await fetch(transport.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
      }

      const json = (await response.json()) as JsonRpcResponse;

      if (json.error) {
        throw new Error(`JSON-RPC error ${json.error.code}: ${json.error.message}`);
      }

      return json.result;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
