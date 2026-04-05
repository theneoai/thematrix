/**
 * MCP Server - Exposes TheMatrix capabilities as MCP tools via JSON-RPC over stdio
 */
import type {
  MCPServerConfig,
  MCPTool,
  MCPToolResult,
  IMCPServer,
} from '@thematrix/types';
import { Logger } from '@thematrix/utils';
import * as readline from 'node:readline';

const logger = new Logger({ prefix: 'MCPServer' });

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type ToolHandler = (args: Record<string, unknown>) => Promise<MCPToolResult>;

export class MCPServer implements IMCPServer {
  private config: MCPServerConfig;
  private tools = new Map<string, { tool: MCPTool; handler: ToolHandler }>();
  private rl: readline.Interface | null = null;
  private initialized = false;
  private running = false;

  constructor(config: MCPServerConfig) {
    this.config = config;
  }

  registerTool(tool: MCPTool, handler: ToolHandler): void {
    this.tools.set(tool.name, { tool, handler });
    logger.info(`Registered tool: ${tool.name}`);
  }

  unregisterTool(name: string): void {
    this.tools.delete(name);
    logger.info(`Unregistered tool: ${name}`);
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Server is already running');
    }

    this.running = true;
    logger.info(`MCP Server "${this.config.name}" starting on stdio transport`);

    this.rl = readline.createInterface({
      input: process.stdin,
      terminal: false,
    });

    this.rl.on('line', (line: string) => {
      if (!line.trim()) return;

      try {
        const request = JSON.parse(line) as JsonRpcRequest;
        void this.handleRequest(request).then((response) => {
          if (response) {
            this.sendResponse(response);
          }
        }).catch((err) => {
          logger.error(`Unhandled error processing request: ${err instanceof Error ? err.message : String(err)}`);
          if (request.id !== undefined) {
            this.sendResponse({
              jsonrpc: '2.0',
              id: request.id ?? null,
              error: { code: -32603, message: 'Internal error' },
            });
          }
        });
      } catch {
        this.sendResponse({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        });
      }
    });

    this.rl.on('close', () => {
      this.running = false;
      logger.info('Stdin closed, server stopping');
    });

    logger.info('MCP Server ready, listening on stdin');
  }

  async stop(): Promise<void> {
    this.running = false;
    this.initialized = false;

    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    logger.info('MCP Server stopped');
  }

  private async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const { method, id, params } = request;

    logger.debug(`Received request: ${method} (id: ${id})`);

    // Notifications (no id) don't require a response
    if (method === 'notifications/initialized') {
      this.initialized = true;
      logger.info('Client confirmed initialization');
      return null;
    }

    if (id === undefined) {
      // Other notifications we don't handle
      return null;
    }

    switch (method) {
      case 'initialize':
        return this.handleInitialize(id);

      case 'tools/list':
        return this.handleToolsList(id);

      case 'tools/call':
        return this.handleToolsCall(id, params ?? {});

      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
    }
  }

  private handleInitialize(id: string | number): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: this.config.name,
          version: this.config.version,
        },
      },
    };
  }

  private handleToolsList(id: string | number): JsonRpcResponse {
    const tools = Array.from(this.tools.values()).map(({ tool }) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));

    return {
      jsonrpc: '2.0',
      id,
      result: { tools },
    };
  }

  private async handleToolsCall(
    id: string | number,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> {
    const toolName = typeof params.name === 'string' ? params.name : '';
    if (!toolName) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: 'Missing required parameter: name' },
      };
    }
    const toolArgs = (typeof params.arguments === 'object' && params.arguments !== null && !Array.isArray(params.arguments)
      ? params.arguments as Record<string, unknown>
      : {});

    const entry = this.tools.get(toolName);
    if (!entry) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: `Unknown tool: ${toolName}` },
      };
    }

    try {
      const result = await entry.handler(toolArgs);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: result.content,
          isError: result.isError ?? false,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Tool ${toolName} failed: ${message}`);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true,
        },
      };
    }
  }

  private sendResponse(response: JsonRpcResponse): void {
    const line = JSON.stringify(response);
    process.stdout.write(line + '\n');
  }
}
