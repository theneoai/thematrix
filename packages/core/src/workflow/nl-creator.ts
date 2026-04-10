/**
 * Natural Language Workflow Creator
 *
 * Uses a Meta-Agent to convert natural language descriptions into
 * workflow definitions + agent configurations. "Use agents to create agents."
 */
import type {
  WorkflowDefinition,
  AgentDefinition,
  LLMAdapter,
  IEventBus,
  DomainEvent,
} from '@thematrix/types';
import { Logger, generateId } from '@thematrix/utils';

const logger = new Logger({ prefix: 'NLWorkflowCreator' });

export interface NLWorkflowResult {
  /** Generated workflow definition */
  workflow: WorkflowDefinition;
  /** Generated agent definitions */
  agents: AgentDefinition[];
  /** Explanation of design decisions */
  reasoning: string;
  /** Confidence in the generated workflow (0-1) */
  confidence: number;
}

export interface NLWorkflowCreatorOptions {
  llmAdapter: LLMAdapter;
  model: string;
  eventBus: IEventBus;
  /** Available agent templates to reference */
  availableAgentIds?: string[];
  /** Available tool names that agents can use */
  availableTools?: string[];
}

export class NLWorkflowCreator {
  private llmAdapter: LLMAdapter;
  private model: string;
  private eventBus: IEventBus;
  private availableAgentIds: string[];
  private availableTools: string[];

  constructor(options: NLWorkflowCreatorOptions) {
    this.llmAdapter = options.llmAdapter;
    this.model = options.model;
    this.eventBus = options.eventBus;
    this.availableAgentIds = options.availableAgentIds ?? [];
    this.availableTools = options.availableTools ?? [];
  }

  /**
   * Convert a natural language description into a workflow definition.
   */
  async createFromDescription(description: string): Promise<NLWorkflowResult> {
    logger.info(`Creating workflow from description: "${description.slice(0, 100)}..."`);

    const systemPrompt = [
      'You are a workflow architect for TheMatrix, a multi-agent orchestration platform.',
      'Convert the user\'s natural language description into a structured workflow.',
      '',
      'Available execution modes:',
      '- dag: Directed acyclic graph with parallel execution and dependencies',
      '- state-machine: Sequential state transitions with conditions',
      '- dynamic: Orchestrator agent decides routing at runtime',
      '- cognitive: Plan-generate-evaluate iterative refinement',
      '',
      this.availableAgentIds.length > 0
        ? `Available existing agents: ${this.availableAgentIds.join(', ')}`
        : 'No existing agents available; you must define new ones.',
      this.availableTools.length > 0
        ? `Available tools: ${this.availableTools.join(', ')}`
        : '',
      '',
      'Respond with ONLY valid JSON in this format:',
      '{',
      '  "workflow": { WorkflowDefinition object },',
      '  "agents": [ array of AgentDefinition objects ],',
      '  "reasoning": "explanation of design decisions",',
      '  "confidence": 0.0-1.0',
      '}',
      '',
      'Requirements for generated agents:',
      '- Each agent needs: id, name, version, persona (systemPrompt, personality, role, traits:{}),',
      '  model (provider: "openai"|"anthropic", model: "gpt-4o"|"claude-sonnet-4-20250514"),',
      '  skills:[], tools:[], memory:{persistHistory:true,maxHistoryTurns:10,scopes:[]},',
      '  maxConcurrency:1, turnTimeoutMs:30000, metadata:{}',
      '',
      'Requirements for workflow:',
      '- id, name, version, mode, agents (record of {ref:agentId} entries),',
      '  sharedMemory:{kvStore:"sqlite",persistent:true}',
      '- For DAG mode: include dag:{nodes:[],edges:[]}',
    ].join('\n');

    const response = await this.llmAdapter.chat({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: description },
      ],
      temperature: 0.2,
      maxTokens: 4096,
    });

    let result: NLWorkflowResult;
    try {
      result = JSON.parse(response.content);
    } catch {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = response.content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error(`Failed to parse workflow from LLM response: ${response.content.slice(0, 200)}`);
      }
    }

    // Assign IDs if missing
    if (!result.workflow.id) result.workflow.id = `wf-${generateId().slice(0, 8)}`;
    if (!result.workflow.version) result.workflow.version = '1.0';
    for (const agent of result.agents) {
      if (!agent.version) agent.version = '1.0';
    }

    await this.publishEvent('workflow.nl_created', {
      description: description.slice(0, 500),
      workflowId: result.workflow.id,
      agentCount: result.agents.length,
      mode: result.workflow.mode,
      confidence: result.confidence,
    });

    logger.info(`Created workflow "${result.workflow.name}" with ${result.agents.length} agents (mode: ${result.workflow.mode}, confidence: ${result.confidence})`);

    return result;
  }

  private async publishEvent(type: string, payload: unknown): Promise<void> {
    const event: DomainEvent = {
      eventId: generateId(),
      type,
      source: { kind: 'system', id: 'nl-workflow-creator' },
      timestamp: new Date(),
      payload,
      correlationId: generateId(),
    };
    await this.eventBus.publish(event);
  }
}
