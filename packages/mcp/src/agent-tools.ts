/**
 * AgentMCPBridge - Lets agents use tools from external MCP servers
 */
import type { MCPTool } from '@thematrix/types';
import { Logger } from '@thematrix/utils';
import type { MCPClient } from './client.js';

const logger = new Logger({ prefix: 'AgentMCPBridge' });

/** Tool handler signature matching AgentRuntime's ToolHandler type */
export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

/**
 * Connect external MCP tools to an agent runtime.
 *
 * Lists all tools from the MCP server, converts each into a ToolHandler,
 * and registers them on the supplied tools map (which can be passed to AgentRuntime).
 *
 * @param client - A connected MCPClient
 * @param tools  - The Map<string, ToolHandler> that will be fed to AgentRuntime
 * @returns The list of MCPTool definitions that were registered
 */
export async function connectExternalTools(
  client: MCPClient,
  tools: Map<string, ToolHandler>,
): Promise<MCPTool[]> {
  if (!client.isConnected()) {
    throw new Error('MCPClient is not connected. Call client.connect() first.');
  }

  const mcpTools = await client.listTools();

  for (const mcpTool of mcpTools) {
    const handler: ToolHandler = async (args: Record<string, unknown>): Promise<unknown> => {
      logger.info(`Forwarding tool call "${mcpTool.name}" to MCP server`);

      const result = await client.callTool({
        name: mcpTool.name,
        arguments: args,
      });

      if (result.isError) {
        const errorText = result.content
          .filter((c) => c.type === 'text')
          .map((c) => (c as { type: 'text'; text: string }).text)
          .join('\n');
        throw new Error(errorText || 'MCP tool call failed');
      }

      // Return text content joined, or the full content array for non-text
      const textParts = result.content.filter((c) => c.type === 'text');
      if (textParts.length === result.content.length) {
        const text = textParts
          .map((c) => (c as { type: 'text'; text: string }).text)
          .join('\n');
        // Try to parse as JSON for structured data
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      }

      return result.content;
    };

    tools.set(mcpTool.name, handler);
    logger.info(`Registered external MCP tool: ${mcpTool.name}`);
  }

  logger.info(`Connected ${mcpTools.length} external MCP tool(s)`);
  return mcpTools;
}
