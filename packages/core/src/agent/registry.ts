/**
 * Agent Registry - 智能体定义注册表
 */
import type { AgentDefinition } from '@thematrix/types';
import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'AgentRegistry' });

export class AgentRegistry {
  private agents = new Map<string, AgentDefinition>();

  register(definition: AgentDefinition): void {
    this.agents.set(definition.id, definition);
    logger.info(`Registered agent: ${definition.id}`);
  }

  unregister(agentId: string): void {
    this.agents.delete(agentId);
    logger.info(`Unregistered agent: ${agentId}`);
  }

  get(agentId: string): AgentDefinition | undefined {
    return this.agents.get(agentId);
  }

  list(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  has(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  clear(): void {
    this.agents.clear();
    logger.info('Cleared all agent definitions');
  }
}
