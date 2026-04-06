/**
 * MCP (Model Context Protocol) 类型定义
 */

// ============================================================
// MCP Server (expose TheMatrix workflows as MCP tools)
// ============================================================

export interface MCPServerConfig {
  /** Server name */
  name: string;
  /** Server version */
  version: string;
  /** Transport: stdio or http */
  transport: 'stdio' | 'http';
  /** HTTP port (for http transport) */
  port?: number;
  /** Workflows to expose as tools */
  exposedWorkflows?: string[];
  /** Agents to expose as tools */
  exposedAgents?: string[];
  /** 支持的协议版本列表 (default: ['2025-03-26', '2024-11-05']) */
  supportedProtocolVersions?: string[];
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface MCPToolResult {
  content: MCPContent[];
  isError?: boolean;
}

export type MCPContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; uri: string; text: string; mimeType?: string };

// ============================================================
// MCP Client (let agents use external MCP tools)
// ============================================================

export interface MCPClientConfig {
  /** Server connection name */
  name: string;
  /** Transport config */
  transport: MCPTransportConfig;
  /** Auto-approve tool calls from this server */
  autoApprove?: boolean;
}

export type MCPTransportConfig =
  | { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
  | { type: 'http'; url: string; headers?: Record<string, string> };

export interface IMCPClient {
  /** Connect to MCP server */
  connect(): Promise<void>;
  /** Disconnect from MCP server */
  disconnect(): Promise<void>;
  /** List available tools */
  listTools(): Promise<MCPTool[]>;
  /** Call a tool */
  callTool(call: MCPToolCall): Promise<MCPToolResult>;
  /** Check if connected */
  isConnected(): boolean;
}

export interface IMCPServer {
  /** Start the server */
  start(): Promise<void>;
  /** Stop the server */
  stop(): Promise<void>;
  /** Register a tool */
  registerTool(tool: MCPTool, handler: (args: Record<string, unknown>) => Promise<MCPToolResult>): void;
  /** Unregister a tool */
  unregisterTool(name: string): void;
}
