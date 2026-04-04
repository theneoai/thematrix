/**
 * 配置文件加载器
 */
import { readFile } from 'fs/promises';
import { parse } from 'yaml';
import type { AgentDefinition, WorkflowDefinition } from '@thematrix/types';
import { agentDefinitionSchema, workflowDefinitionSchema } from './schemas.js';
import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'ConfigLoader' });

export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: string[]
  ) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

export async function loadAgentDefinition(
  filePath: string
): Promise<AgentDefinition> {
  const content = await readFile(filePath, 'utf-8');
  const parsed = parse(content);
  
  const result = agentDefinitionSchema.safeParse(parsed);
  
  if (!result.success) {
    const errors = result.error.errors.map(
      (e) => `${e.path.join('.')}: ${e.message}`
    );
    logger.error(`Failed to validate agent config: ${filePath}`, errors);
    throw new ConfigValidationError('Invalid agent configuration', errors);
  }
  
  logger.info(`Loaded agent definition: ${result.data.id}`);
  return result.data as AgentDefinition;
}

export async function loadWorkflowDefinition(
  filePath: string
): Promise<WorkflowDefinition> {
  const content = await readFile(filePath, 'utf-8');
  const parsed = parse(content);
  
  const result = workflowDefinitionSchema.safeParse(parsed);
  
  if (!result.success) {
    const errors = result.error.errors.map(
      (e) => `${e.path.join('.')}: ${e.message}`
    );
    logger.error(`Failed to validate workflow config: ${filePath}`, errors);
    throw new ConfigValidationError('Invalid workflow configuration', errors);
  }
  
  logger.info(`Loaded workflow definition: ${result.data.id}`);
  return result.data as WorkflowDefinition;
}

export function validateAgentDefinition(
  data: unknown
): { success: true; data: AgentDefinition } | { success: false; errors: string[] } {
  const result = agentDefinitionSchema.safeParse(data);
  
  if (result.success) {
    return { success: true, data: result.data as AgentDefinition };
  }
  
  return {
    success: false,
    errors: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
  };
}

export function validateWorkflowDefinition(
  data: unknown
): { success: true; data: WorkflowDefinition } | { success: false; errors: string[] } {
  const result = workflowDefinitionSchema.safeParse(data);
  
  if (result.success) {
    return { success: true, data: result.data as WorkflowDefinition };
  }
  
  return {
    success: false,
    errors: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
  };
}
