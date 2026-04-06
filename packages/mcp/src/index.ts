/**
 * @thematrix/mcp - Model Context Protocol support for TheMatrix
 *
 * Provides:
 * - MCPServer: Expose TheMatrix workflows/agents as MCP tools
 * - MCPClient: Connect to external MCP servers to use their tools
 * - WorkflowMCPBridge: Bridge between workflows and MCP server
 * - AgentMCPBridge: Bridge between external MCP tools and agent runtimes
 */

export { MCPServer } from './server.js';
export { MCPClient } from './client.js';
export { exposeWorkflows, type IWorkflowEngine } from './workflow-tools.js';
export { connectExternalTools, type ToolHandler } from './agent-tools.js';

// A2A Protocol
export { A2AClient } from './a2a-client.js';
export { A2AServer, AgentRegistry, type A2AServerConfig } from './a2a-server.js';
