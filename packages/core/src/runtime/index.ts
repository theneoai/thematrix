/**
 * TheMatrix Runtime - 简化版运行时入口
 */
import type { WorkflowDefinition, AgentDefinition } from '@thematrix/types';
import { EventBus, SQLiteEventStore, MemoryManager, AgentRegistry, WorkflowEngine } from '../index.js';
import { Logger } from '@thematrix/utils';
import { MockLLMAdapter } from '@thematrix/adapters';

const logger = new Logger({ prefix: 'Runtime' });

export interface RuntimeOptions {
  dbPath?: string;
}

export class Runtime {
  private eventBus: EventBus;
  private memory: MemoryManager;
  private agentRegistry: AgentRegistry;
  private workflowEngine: WorkflowEngine;
  private agentIdMap = new Map<string, string>();

  constructor(options: RuntimeOptions = {}) {
    const eventStore = new SQLiteEventStore(options.dbPath ?? ':memory:');
    this.eventBus = new EventBus(eventStore);
    this.memory = new MemoryManager({ dbPath: options.dbPath ?? ':memory:' });
    this.agentRegistry = new AgentRegistry();
    
    this.workflowEngine = new WorkflowEngine({
      eventBus: this.eventBus,
      memory: this.memory,
      agentRegistry: this.agentRegistry,
      llmAdapterFactory: () => new MockLLMAdapter(),
      agentIdMap: this.agentIdMap,
    });
  }

  registerAgent(definition: AgentDefinition, aliases?: string[]): void {
    this.agentRegistry.register(definition);
    // Register aliases (e.g., file paths) that map to this agent ID
    if (aliases) {
      for (const alias of aliases) {
        this.agentIdMap.set(alias, definition.id);
      }
    }
  }

  async runWorkflow(definition: WorkflowDefinition, input: Record<string, unknown>) {
    // Register agent name mappings from workflow
    for (const [name, ref] of Object.entries(definition.agents)) {
      // Map the agent name to the resolved agent ID if we have it
      if (!this.agentIdMap.has(name) && this.agentIdMap.has(ref.ref)) {
        this.agentIdMap.set(name, this.agentIdMap.get(ref.ref)!);
      }
    }

    const run = await this.workflowEngine.startWorkflow(definition, input);
    
    logger.info(`Workflow ${definition.id} started with run ID: ${run.runId}`);
    
    return run;
  }

  getWorkflowRun(runId: string) {
    return this.workflowEngine.getRun(runId);
  }

  getAllRuns() {
    return this.workflowEngine.getRuns();
  }

  async pauseWorkflow(runId: string) {
    await this.workflowEngine.pauseWorkflow(runId);
  }

  async resumeWorkflow(runId: string) {
    await this.workflowEngine.resumeWorkflow(runId);
  }

  async cancelWorkflow(runId: string) {
    await this.workflowEngine.cancelWorkflow(runId);
  }

  close(): void {
    this.memory.close();
  }
}
