/**
 * Cognitive Memory 类型定义
 *
 * 基于认知科学的三层记忆架构:
 * - Episodic Memory: 情景记忆 -- 具体事件和经历的记录
 * - Semantic Memory: 语义记忆 -- 结构化事实和知识
 * - Procedural Memory: 程序记忆 -- 工具使用模式和成功的工作流
 */

// ============================================================
// Episodic Memory (情景记忆)
// ============================================================

export interface EpisodicMemory {
  id: string;
  /** 关联的 Agent ID */
  agentId: string;
  /** 事件类型 */
  eventType: 'task-completion' | 'error-recovery' | 'handoff' | 'user-feedback' | 'milestone';
  /** 事件摘要 */
  summary: string;
  /** 事件上下文 */
  context: {
    workflowRunId?: string;
    input?: string;
    output?: string;
    toolsUsed?: string[];
    agentsInvolved?: string[];
  };
  /** 结果评价 */
  outcome: 'success' | 'partial' | 'failure';
  /** 从中学到的教训 */
  lessons?: string[];
  /** 重要性评分 (0-1, 越高越不容易被遗忘) */
  importance: number;
  /** 最后访问时间 (用于衰减计算) */
  lastAccessedAt: Date;
  /** 访问次数 */
  accessCount: number;
  /** 创建时间 */
  createdAt: Date;
}

// ============================================================
// Semantic Memory (语义记忆)
// ============================================================

export interface SemanticFact {
  id: string;
  /** 主体 */
  subject: string;
  /** 谓词/关系 */
  predicate: string;
  /** 客体 */
  object: string;
  /** 置信度 (0-1) */
  confidence: number;
  /** 来源 (从哪个 episode 提取) */
  sourceEpisodeIds: string[];
  /** 命名空间 (用于分域管理) */
  namespace: string;
  /** 创建时间 */
  createdAt: Date;
  /** 最后验证时间 */
  lastVerifiedAt: Date;
}

export interface UserPreference {
  id: string;
  /** 用户/Agent ID */
  ownerId: string;
  /** 偏好类别 */
  category: string;
  /** 偏好键 */
  key: string;
  /** 偏好值 */
  value: unknown;
  /** 置信度 */
  confidence: number;
  /** 来源 */
  source: 'explicit' | 'inferred';
  /** 更新时间 */
  updatedAt: Date;
}

// ============================================================
// Procedural Memory (程序记忆)
// ============================================================

export interface ProceduralPattern {
  id: string;
  /** 模式名称 */
  name: string;
  /** 适用目标描述 */
  goalPattern: string;
  /** 工具调用序列 */
  toolSequence: ProceduralStep[];
  /** 成功率 */
  successRate: number;
  /** 平均完成时间 (ms) */
  avgDurationMs: number;
  /** 使用次数 */
  usageCount: number;
  /** 前置条件 */
  preconditions?: string[];
  /** 创建时间 */
  createdAt: Date;
  /** 最后使用时间 */
  lastUsedAt: Date;
}

export interface ProceduralStep {
  /** 步骤序号 */
  order: number;
  /** 工具名称 or Agent ID */
  toolOrAgent: string;
  /** 参数模板 */
  argsTemplate?: Record<string, unknown>;
  /** 期望输出模式 */
  expectedOutputPattern?: string;
  /** 平均耗时 */
  avgDurationMs?: number;
}

// ============================================================
// Cognitive Memory Manager 接口
// ============================================================

export interface ICognitiveMemoryManager {
  // --- Episodic Memory ---
  /** 记录新的情景 */
  recordEpisode(episode: Omit<EpisodicMemory, 'id' | 'lastAccessedAt' | 'accessCount' | 'createdAt'>): Promise<string>;
  /** 检索相关情景 (语义搜索) */
  recallEpisodes(query: string, options?: EpisodeRecallOptions): Promise<EpisodicMemory[]>;
  /** 获取特定 Agent 的近期情景 */
  getRecentEpisodes(agentId: string, limit?: number): Promise<EpisodicMemory[]>;

  // --- Semantic Memory ---
  /** 存储语义事实 */
  storeFact(fact: Omit<SemanticFact, 'id' | 'createdAt' | 'lastVerifiedAt'>): Promise<string>;
  /** 查询事实 */
  queryFacts(query: { subject?: string; predicate?: string; object?: string; namespace?: string }): Promise<SemanticFact[]>;
  /** 存储用户偏好 */
  storePreference(pref: Omit<UserPreference, 'id' | 'updatedAt'>): Promise<string>;
  /** 获取用户偏好 */
  getPreferences(ownerId: string, category?: string): Promise<UserPreference[]>;

  // --- Procedural Memory ---
  /** 记录成功的工具调用模式 */
  recordProcedure(pattern: Omit<ProceduralPattern, 'id' | 'successRate' | 'usageCount' | 'createdAt' | 'lastUsedAt'>): Promise<string>;
  /** 根据目标查找最佳程序模式 */
  findProcedures(goal: string, topK?: number): Promise<ProceduralPattern[]>;
  /** 更新程序模式的使用统计 */
  updateProcedureStats(patternId: string, success: boolean, durationMs: number): Promise<void>;

  // --- Memory Consolidation ---
  /** 触发记忆整合 (将短期记忆consolidate到长期) */
  consolidate(agentId: string): Promise<ConsolidationResult>;
  /** 记忆衰减 (降低长时间未访问记忆的重要性) */
  decay(options?: DecayOptions): Promise<number>;
}

export interface EpisodeRecallOptions {
  /** 最大返回数量 */
  topK?: number;
  /** 仅限特定 Agent */
  agentId?: string;
  /** 最小重要性 */
  minImportance?: number;
  /** 时间范围 (ms) */
  timeWindowMs?: number;
  /** 结果类型过滤 */
  eventTypes?: EpisodicMemory['eventType'][];
}

export interface ConsolidationResult {
  /** 提取的新事实数量 */
  factsExtracted: number;
  /** 发现的新程序模式数量 */
  patternsDiscovered: number;
  /** 被遗忘的低价值记忆数量 */
  memoriesForgotten: number;
  /** 处理的情景数量 */
  episodesProcessed: number;
}

export interface DecayOptions {
  /** 衰减因子 (0-1, 越小衰减越快) */
  decayFactor?: number;
  /** 最小重要性 (低于此值的记忆被清除) */
  minImportance?: number;
  /** 仅作用于特定 Agent */
  agentId?: string;
}
