/**
 * WorkflowMCPBridge - Exposes TheMatrix workflows as MCP tools
 */
import type {
  MCPToolResult,
  WorkflowDefinition,
  WorkflowRun,
} from '@thematrix/types';
import { Logger } from '@thematrix/utils';
import type { MCPServer } from './server.js';

const logger = new Logger({ prefix: 'WorkflowMCPBridge' });

/** Minimal interface for the workflow engine to avoid a hard dependency on @thematrix/core */
export interface IWorkflowEngine {
  startWorkflow(
    definition: WorkflowDefinition,
    input: Record<string, unknown>,
  ): Promise<WorkflowRun>;
  getRun(runId: string): WorkflowRun | undefined;
}

const POLL_INTERVAL_MS = 1000;
const MAX_POLL_MS = 300_000; // 5 minutes

/**
 * Expose a set of workflows as MCP tools on the given server.
 */
export function exposeWorkflows(
  server: MCPServer,
  workflowEngine: IWorkflowEngine,
  workflows: WorkflowDefinition[],
): void {
  // Register a tool for each workflow
  for (const workflow of workflows) {
    const toolName = `run_workflow_${workflow.id}`;

    server.registerTool(
      {
        name: toolName,
        description: workflow.description ?? `Run workflow: ${workflow.name}`,
        inputSchema: workflow.inputSchema ?? {
          type: 'object',
          properties: {},
        },
      },
      async (args: Record<string, unknown>): Promise<MCPToolResult> => {
        try {
          logger.info(`Starting workflow ${workflow.id} via MCP`);
          const run = await workflowEngine.startWorkflow(workflow, args);

          // Poll for completion
          const result = await pollWorkflowCompletion(workflowEngine, run.runId);

          if (result.status === 'completed') {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    runId: result.runId,
                    status: result.status,
                    output: result.output ?? {},
                  }),
                },
              ],
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  runId: result.runId,
                  status: result.status,
                  error: result.error ?? 'Workflow did not complete successfully',
                }),
              },
            ],
            isError: true,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error(`Workflow ${workflow.id} failed: ${message}`);
          return {
            content: [{ type: 'text', text: `Error: ${message}` }],
            isError: true,
          };
        }
      },
    );

    logger.info(`Exposed workflow "${workflow.id}" as MCP tool "${toolName}"`);
  }

  // Register a generic status tool
  server.registerTool(
    {
      name: 'get_workflow_status',
      description: 'Get the status of a running workflow by its run ID',
      inputSchema: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'The workflow run ID' },
        },
        required: ['runId'],
      },
    },
    async (args: Record<string, unknown>): Promise<MCPToolResult> => {
      const runId = args.runId as string;
      const run = workflowEngine.getRun(runId);

      if (!run) {
        return {
          content: [{ type: 'text', text: `Workflow run not found: ${runId}` }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              runId: run.runId,
              workflowId: run.workflowId,
              status: run.status,
              output: run.output,
              error: run.error,
              startedAt: run.startedAt,
              completedAt: run.completedAt,
            }),
          },
        ],
      };
    },
  );

  logger.info(`Exposed ${workflows.length} workflow(s) and get_workflow_status as MCP tools`);
}

async function pollWorkflowCompletion(
  engine: IWorkflowEngine,
  runId: string,
): Promise<WorkflowRun> {
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_POLL_MS) {
    const run = engine.getRun(runId);
    if (!run) {
      throw new Error(`Workflow run ${runId} disappeared`);
    }

    if (
      run.status === 'completed' ||
      run.status === 'failed' ||
      run.status === 'cancelled' ||
      run.status === 'timed_out'
    ) {
      return run;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Workflow run ${runId} timed out after ${MAX_POLL_MS}ms`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
