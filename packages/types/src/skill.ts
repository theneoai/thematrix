/**
 * Skill 类型定义
 */

import type { IMemoryManager } from './memory.js';

export interface SkillDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  entryPoint: string;
  tools: SkillToolDefinition[];
  permissions: SkillPermission[];
  configSchema?: Record<string, unknown>;
}

export interface SkillToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface SkillPermission {
  resource: string;
  actions: string[];
}

export interface SkillContext {
  skillId: string;
  config: Record<string, unknown>;
  memory: IMemoryManager;
  workflowRunId: string;
  agentInstanceId: string;
}

export type SkillToolHandler = (
  args: Record<string, unknown>,
  context: SkillContext
) => Promise<unknown>;

export interface SkillModule {
  initialize(context: SkillContext): Promise<void>;
  dispose?(): Promise<void>;
  handlers: Record<string, SkillToolHandler>;
}

export interface ISkillRegistry {
  register(skill: SkillDefinition): void;
  unregister(skillId: string): void;
  get(skillId: string): SkillDefinition | undefined;
  list(): SkillDefinition[];
  load(modulePath: string): Promise<SkillModule>;
}
