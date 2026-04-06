/**
 * Tool Composer - Dynamic tool discovery and composition
 *
 * Enables agents to discover tools from external MCP servers at runtime,
 * compose multi-step tool chains, and cache tool schemas for performance.
 * Bridges the gap between static tool registration and dynamic agentic tool use.
 */
import { Logger, generateId } from '@thematrix/utils';
import type { ToolHandler } from './runtime.js';

const logger = new Logger({ prefix: 'ToolComposer' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolSource {
  type: 'mcp' | 'registry' | 'static';
  endpoint?: string; // for MCP
  tools?: ToolDefinition[]; // for static
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  source: string;
  tags?: string[];
  permissions?: string[];
}

export interface PipelineStep {
  toolName: string;
  inputMapping?: Record<string, string>; // maps from prior step outputs
  outputKey: string; // key to store result under
}

export interface ComposedTool {
  name: string;
  description: string;
  steps: PipelineStep[];
  execute: (initialInput: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// ToolComposer
// ---------------------------------------------------------------------------

export class ToolComposer {
  /** Registered tool definitions keyed by name. */
  private readonly definitions = new Map<string, ToolDefinition>();

  /** Registered tool handlers keyed by name. */
  private readonly handlers = new Map<string, ToolHandler>();

  /** Per-agent permission overrides – maps agentId to allowed tool names. */
  private readonly agentPermissions = new Map<string, Set<string>>();

  // -----------------------------------------------------------------------
  // Discovery
  // -----------------------------------------------------------------------

  /**
   * Discover available tools from an MCP server, a registry endpoint, or a
   * static list of definitions.
   *
   * For MCP / registry sources an HTTP fetch is performed against the
   * endpoint.  For static sources the provided definitions are returned
   * directly.
   */
  async discoverTools(source: ToolSource): Promise<ToolDefinition[]> {
    logger.info(`Discovering tools from ${source.type} source`);

    switch (source.type) {
      case 'static': {
        const tools = source.tools ?? [];
        for (const tool of tools) {
          this.definitions.set(tool.name, tool);
        }
        logger.info(`Discovered ${tools.length} static tools`);
        return tools;
      }

      case 'mcp': {
        if (!source.endpoint) {
          throw new Error('MCP tool source requires an endpoint');
        }

        try {
          const response = await fetch(source.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: generateId(), method: 'tools/list', params: {} }),
          });

          if (!response.ok) {
            throw new Error(`MCP server returned ${response.status}`);
          }

          const json = (await response.json()) as { result?: { tools?: ToolDefinition[] } };
          const tools: ToolDefinition[] = (json.result?.tools ?? []).map((t: ToolDefinition) => ({
            ...t,
            source: source.endpoint!,
          }));

          for (const tool of tools) {
            this.definitions.set(tool.name, tool);
          }

          logger.info(`Discovered ${tools.length} tools from MCP server ${source.endpoint}`);
          return tools;
        } catch (err) {
          logger.error(`Failed to discover tools from MCP server: ${(err as Error).message}`);
          throw err;
        }
      }

      case 'registry': {
        if (!source.endpoint) {
          throw new Error('Registry tool source requires an endpoint');
        }

        try {
          const response = await fetch(source.endpoint);
          if (!response.ok) {
            throw new Error(`Registry returned ${response.status}`);
          }

          const tools = (await response.json()) as ToolDefinition[];

          for (const tool of tools) {
            this.definitions.set(tool.name, { ...tool, source: source.endpoint! });
          }

          logger.info(`Discovered ${tools.length} tools from registry ${source.endpoint}`);
          return tools;
        } catch (err) {
          logger.error(`Failed to discover tools from registry: ${(err as Error).message}`);
          throw err;
        }
      }

      default:
        throw new Error(`Unknown tool source type: ${(source as ToolSource).type}`);
    }
  }

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  /** Register a tool definition together with its handler. */
  registerTool(definition: ToolDefinition, handler: ToolHandler): void {
    this.definitions.set(definition.name, definition);
    this.handlers.set(definition.name, handler);
    logger.info(`Registered tool: ${definition.name}`);
  }

  // -----------------------------------------------------------------------
  // Composition
  // -----------------------------------------------------------------------

  /**
   * Compose multiple tools into a sequential pipeline. The returned
   * {@link ComposedTool} executes each step in order, threading outputs
   * from earlier steps into the inputs of later steps via `inputMapping`.
   */
  composePipeline(steps: PipelineStep[]): ComposedTool {
    const stepNames = steps.map((s) => s.toolName);
    const name = `pipeline:${stepNames.join('>')}`;
    const description = `Composed pipeline of [${stepNames.join(', ')}]`;

    logger.info(`Composing pipeline: ${name}`);

    // Validate that all referenced tools are registered with handlers.
    for (const step of steps) {
      if (!this.handlers.has(step.toolName)) {
        throw new Error(`Cannot compose pipeline: no handler registered for tool "${step.toolName}"`);
      }
    }

    // Capture handler references so the execute closure is self-contained.
    const handlers = new Map(this.handlers);

    const execute = async (initialInput: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const results: Record<string, unknown> = { ...initialInput };

      for (const step of steps) {
        const handler = handlers.get(step.toolName);
        if (!handler) {
          throw new Error(`Handler for tool "${step.toolName}" not found during pipeline execution`);
        }

        // Build input args: start from initialInput, then overlay mapped values.
        const args: Record<string, unknown> = {};

        if (step.inputMapping) {
          for (const [argName, sourceKey] of Object.entries(step.inputMapping)) {
            if (sourceKey in results) {
              args[argName] = results[sourceKey];
            }
          }
        }

        logger.debug(`Pipeline step: ${step.toolName} args=${JSON.stringify(args)}`);

        const output = await handler(args);
        results[step.outputKey] = output;
      }

      return results;
    };

    return { name, description, steps, execute };
  }

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  /**
   * Get the set of tool handlers an agent is allowed to use, optionally
   * filtered by a list of permission tags.
   */
  getToolsForAgent(agentId: string, permissions?: string[]): Map<string, ToolHandler> {
    const filtered = new Map<string, ToolHandler>();

    for (const [name, handler] of this.handlers) {
      const def = this.definitions.get(name);
      if (!def) continue;

      // If permissions filter is provided, the tool must declare at least
      // one matching permission tag.
      if (permissions && permissions.length > 0) {
        const toolPerms = def.permissions ?? [];
        const hasMatch = toolPerms.some((p) => permissions.includes(p));
        if (!hasMatch) continue;
      }

      filtered.set(name, handler);
    }

    logger.debug(`Agent ${agentId} granted access to ${filtered.size} tools`);
    return filtered;
  }

  /** Look up a single tool schema by name. */
  getToolSchema(name: string): ToolDefinition | undefined {
    return this.definitions.get(name);
  }

  /** List all known tool definitions. */
  listTools(): ToolDefinition[] {
    return Array.from(this.definitions.values());
  }
}
