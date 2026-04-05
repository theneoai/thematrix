/**
 * Agent Planner - generates and revises execution plans using LLM
 */
import type {
  AgentPlan,
  PlanStep,
  LLMAdapter,
  DomainEvent,
} from '@thematrix/types';
import { EventTypes, type IEventBus } from '@thematrix/types';
import { Logger, generateId } from '@thematrix/utils';

const logger = new Logger({ prefix: 'AgentPlanner' });

const PLANNING_SYSTEM_PROMPT = `You are a planning agent. Given a goal, break it down into a sequence of concrete steps.

Each step should have:
- id: a unique short identifier (e.g. "step-1")
- description: what this step accomplishes
- agentId (optional): if this step should be delegated to another agent, specify its id
- toolName (optional): if this step requires a specific tool, specify its name
- dependsOn (optional): array of step ids that must complete before this step

Respond ONLY with valid JSON in this exact format:
{
  "steps": [
    {
      "id": "step-1",
      "description": "...",
      "agentId": null,
      "toolName": null,
      "dependsOn": []
    }
  ]
}

Keep plans concise. Prefer fewer steps that each accomplish something meaningful.`;

const REVISE_SYSTEM_PROMPT = `You are a planning agent revising an existing plan based on execution feedback.

Given the original plan and feedback about what went wrong or needs changing, produce a revised plan.
You may add, remove, modify, or reorder steps. Mark steps that were already completed successfully as-is.

Respond ONLY with valid JSON in this exact format:
{
  "steps": [
    {
      "id": "step-1",
      "description": "...",
      "agentId": null,
      "toolName": null,
      "dependsOn": [],
      "status": "pending"
    }
  ]
}

Valid status values: "pending", "completed", "skipped". Use "completed" for steps already done, "skipped" for steps no longer needed.`;

export class AgentPlanner {
  private llmAdapter: LLMAdapter;
  private eventBus: IEventBus;
  private model: string;
  private sourceId: string;
  private correlationId: string;

  constructor(options: {
    llmAdapter: LLMAdapter;
    eventBus: IEventBus;
    model: string;
    sourceId: string;
    correlationId: string;
  }) {
    this.llmAdapter = options.llmAdapter;
    this.eventBus = options.eventBus;
    this.model = options.model;
    this.sourceId = options.sourceId;
    this.correlationId = options.correlationId;
  }

  async createPlan(
    goal: string,
    availableTools: string[],
    availableAgents: string[],
  ): Promise<AgentPlan> {
    logger.info(`Creating plan for goal: ${goal}`);

    const userContent = [
      `Goal: ${goal}`,
      '',
      `Available tools: ${availableTools.length > 0 ? availableTools.join(', ') : 'none'}`,
      `Available agents for delegation: ${availableAgents.length > 0 ? availableAgents.join(', ') : 'none'}`,
    ].join('\n');

    const response = await this.llmAdapter.chat({
      model: this.model,
      messages: [
        { role: 'system', content: PLANNING_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      responseFormat: { type: 'json_object' },
      temperature: 0.2,
    });

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(response.content);
    } catch {
      logger.error(`Failed to parse plan JSON: ${response.content.slice(0, 200)}`);
      throw new Error('Planner returned invalid JSON');
    }

    const steps: PlanStep[] = (Array.isArray(parsed.steps) ? parsed.steps : []).map((s: Record<string, unknown>) => ({
      id: String(s.id ?? generateId()),
      description: String(s.description ?? ''),
      agentId: s.agentId ? String(s.agentId) : undefined,
      toolName: s.toolName ? String(s.toolName) : undefined,
      status: 'pending' as const,
      dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn.map(String) : undefined,
    }));

    const plan: AgentPlan = {
      planId: generateId(),
      goal,
      steps,
      createdAt: new Date(),
      status: 'draft',
      revision: 0,
    };

    await this.publishEvent(EventTypes.AGENT_PLAN_CREATED, { plan });
    logger.info(`Plan created with ${steps.length} steps (planId=${plan.planId})`);

    return plan;
  }

  async revisePlan(plan: AgentPlan, feedback: string): Promise<AgentPlan> {
    logger.info(`Revising plan ${plan.planId}: ${feedback}`);

    const userContent = [
      `Original goal: ${plan.goal}`,
      '',
      `Current plan:`,
      JSON.stringify(plan.steps, null, 2),
      '',
      `Feedback / reason for revision:`,
      feedback,
    ].join('\n');

    const response = await this.llmAdapter.chat({
      model: this.model,
      messages: [
        { role: 'system', content: REVISE_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      responseFormat: { type: 'json_object' },
      temperature: 0.2,
    });

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(response.content);
    } catch {
      logger.error(`Failed to parse revised plan JSON: ${response.content.slice(0, 200)}`);
      throw new Error('Planner returned invalid JSON during revision');
    }

    const steps: PlanStep[] = (Array.isArray(parsed.steps) ? parsed.steps : []).map((s: Record<string, unknown>) => ({
      id: String(s.id ?? generateId()),
      description: String(s.description ?? ''),
      agentId: s.agentId ? String(s.agentId) : undefined,
      toolName: s.toolName ? String(s.toolName) : undefined,
      status: (['pending', 'completed', 'skipped', 'running', 'failed'] as const).includes(s.status as PlanStep['status'])
        ? (s.status as PlanStep['status'])
        : 'pending',
      dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn.map(String) : undefined,
    }));

    const revised: AgentPlan = {
      planId: plan.planId,
      goal: plan.goal,
      steps,
      createdAt: plan.createdAt,
      status: 'revised',
      revision: (plan.revision ?? 0) + 1,
    };

    await this.publishEvent(EventTypes.AGENT_PLAN_REVISED, { plan: revised, feedback });
    logger.info(`Plan revised to revision ${revised.revision} with ${steps.length} steps`);

    return revised;
  }

  private async publishEvent(type: string, payload: unknown): Promise<void> {
    const event: DomainEvent = {
      eventId: generateId(),
      type,
      source: { kind: 'agent', id: this.sourceId },
      timestamp: new Date(),
      payload,
      correlationId: this.correlationId,
    };
    await this.eventBus.publish(event);
  }
}
