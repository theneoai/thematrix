/**
 * Cognitive Memory Manager - 认知启发的三层记忆架构
 *
 * 实现 Episodic/Semantic/Procedural 三层记忆模型:
 * - 情景记忆: 记录和检索 Agent 的具体经历
 * - 语义记忆: 存储提取的结构化事实和知识
 * - 程序记忆: 记录成功的工具调用模式
 *
 * 支持记忆整合(consolidation)和遗忘衰减(decay)机制。
 */
import type {
  ICognitiveMemoryManager,
  EpisodicMemory,
  SemanticFact,
  UserPreference,
  ProceduralPattern,
  EpisodeRecallOptions,
  ConsolidationResult,
  DecayOptions,
  IEmbeddingProvider,
} from '@thematrix/types';
import { Logger, generateId } from '@thematrix/utils';
import Database from 'better-sqlite3';

const logger = new Logger({ prefix: 'CognitiveMemory' });

export interface CognitiveMemoryOptions {
  dbPath?: string;
  embeddingProvider?: IEmbeddingProvider;
  /** 默认衰减因子 (0-1) */
  defaultDecayFactor?: number;
  /** 最小重要性 (低于此值被清除) */
  minImportanceThreshold?: number;
}

export class CognitiveMemoryManager implements ICognitiveMemoryManager {
  private db: Database.Database;
  private embeddingProvider?: IEmbeddingProvider;
  private readonly decayFactor: number;
  private readonly minImportance: number;

  constructor(options: CognitiveMemoryOptions = {}) {
    this.db = new Database(options.dbPath ?? ':memory:');
    this.embeddingProvider = options.embeddingProvider;
    this.decayFactor = options.defaultDecayFactor ?? 0.95;
    this.minImportance = options.minImportanceThreshold ?? 0.05;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      -- Episodic Memory
      CREATE TABLE IF NOT EXISTS episodic_memory (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        summary TEXT NOT NULL,
        context TEXT NOT NULL DEFAULT '{}',
        outcome TEXT NOT NULL,
        lessons TEXT,
        importance REAL NOT NULL DEFAULT 0.5,
        last_accessed_at TEXT NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        embedding TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_episodic_agent ON episodic_memory(agent_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_episodic_importance ON episodic_memory(importance);

      -- Semantic Facts
      CREATE TABLE IF NOT EXISTS semantic_facts (
        id TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        source_episode_ids TEXT NOT NULL DEFAULT '[]',
        namespace TEXT NOT NULL DEFAULT 'default',
        created_at TEXT NOT NULL,
        last_verified_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_facts_subject ON semantic_facts(subject);
      CREATE INDEX IF NOT EXISTS idx_facts_namespace ON semantic_facts(namespace);

      -- User Preferences
      CREATE TABLE IF NOT EXISTS user_preferences (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        category TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        source TEXT NOT NULL DEFAULT 'inferred',
        updated_at TEXT NOT NULL,
        UNIQUE(owner_id, category, key)
      );
      CREATE INDEX IF NOT EXISTS idx_prefs_owner ON user_preferences(owner_id, category);

      -- Procedural Patterns
      CREATE TABLE IF NOT EXISTS procedural_patterns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        goal_pattern TEXT NOT NULL,
        tool_sequence TEXT NOT NULL DEFAULT '[]',
        success_rate REAL NOT NULL DEFAULT 0.0,
        avg_duration_ms REAL NOT NULL DEFAULT 0.0,
        usage_count INTEGER NOT NULL DEFAULT 0,
        preconditions TEXT,
        created_at TEXT NOT NULL,
        last_used_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_proc_usage ON procedural_patterns(usage_count DESC);
    `);
    logger.info('Cognitive memory schema initialized');
  }

  // =====================================================================
  // Episodic Memory
  // =====================================================================

  async recordEpisode(
    episode: Omit<EpisodicMemory, 'id' | 'lastAccessedAt' | 'accessCount' | 'createdAt'>,
  ): Promise<string> {
    const id = generateId();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO episodic_memory (id, agent_id, event_type, summary, context, outcome, lessons, importance, last_accessed_at, access_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `);

    stmt.run(
      id,
      episode.agentId,
      episode.eventType,
      episode.summary,
      JSON.stringify(episode.context),
      episode.outcome,
      episode.lessons ? JSON.stringify(episode.lessons) : null,
      episode.importance,
      now,
      now,
    );

    logger.debug(`Recorded episode ${id}: ${episode.eventType} (${episode.outcome})`);
    return id;
  }

  async recallEpisodes(query: string, options: EpisodeRecallOptions = {}): Promise<EpisodicMemory[]> {
    const topK = options.topK ?? 5;

    // Build SQL query with filters
    let sql = 'SELECT * FROM episodic_memory WHERE 1=1';
    const params: unknown[] = [];

    if (options.agentId) {
      sql += ' AND agent_id = ?';
      params.push(options.agentId);
    }
    if (options.minImportance !== undefined) {
      sql += ' AND importance >= ?';
      params.push(options.minImportance);
    }
    if (options.timeWindowMs) {
      const since = new Date(Date.now() - options.timeWindowMs).toISOString();
      sql += ' AND created_at >= ?';
      params.push(since);
    }
    if (options.eventTypes && options.eventTypes.length > 0) {
      sql += ` AND event_type IN (${options.eventTypes.map(() => '?').join(',')})`;
      params.push(...options.eventTypes);
    }

    // Text-based relevance: search in summary (simple LIKE matching)
    // For production, use vector similarity with embeddings
    if (query) {
      sql += " AND summary LIKE ? ESCAPE '\\'";
      const escaped = query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      params.push(`%${escaped}%`);
    }

    sql += ' ORDER BY importance DESC, last_accessed_at DESC LIMIT ?';
    params.push(topK);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as EpisodicRow[];

    // Update access count and last accessed (batched in transaction)
    if (rows.length > 0) {
      const updateStmt = this.db.prepare(
        'UPDATE episodic_memory SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?',
      );
      const now = new Date().toISOString();
      const batchUpdate = this.db.transaction(() => {
        for (const row of rows) {
          updateStmt.run(now, row.id);
        }
      });
      batchUpdate();
    }

    return rows.map(rowToEpisodic);
  }

  async getRecentEpisodes(agentId: string, limit: number = 10): Promise<EpisodicMemory[]> {
    const stmt = this.db.prepare(
      'SELECT * FROM episodic_memory WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?',
    );
    const rows = stmt.all(agentId, limit) as EpisodicRow[];
    return rows.map(rowToEpisodic);
  }

  // =====================================================================
  // Semantic Memory
  // =====================================================================

  async storeFact(
    fact: Omit<SemanticFact, 'id' | 'createdAt' | 'lastVerifiedAt'>,
  ): Promise<string> {
    const id = generateId();
    const now = new Date().toISOString();

    // Upsert: if a fact with same subject+predicate+object+namespace exists, update confidence
    const existing = this.db.prepare(
      'SELECT id FROM semantic_facts WHERE subject = ? AND predicate = ? AND object = ? AND namespace = ?',
    ).get(fact.subject, fact.predicate, fact.object, fact.namespace) as { id: string } | undefined;

    if (existing) {
      this.db.prepare(
        'UPDATE semantic_facts SET confidence = MAX(confidence, ?), last_verified_at = ?, source_episode_ids = ? WHERE id = ?',
      ).run(fact.confidence, now, JSON.stringify(fact.sourceEpisodeIds), existing.id);
      return existing.id;
    }

    this.db.prepare(`
      INSERT INTO semantic_facts (id, subject, predicate, object, confidence, source_episode_ids, namespace, created_at, last_verified_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, fact.subject, fact.predicate, fact.object, fact.confidence, JSON.stringify(fact.sourceEpisodeIds), fact.namespace, now, now);

    logger.debug(`Stored fact: ${fact.subject} ${fact.predicate} ${fact.object}`);
    return id;
  }

  async queryFacts(query: {
    subject?: string;
    predicate?: string;
    object?: string;
    namespace?: string;
  }): Promise<SemanticFact[]> {
    let sql = 'SELECT * FROM semantic_facts WHERE 1=1';
    const params: string[] = [];

    if (query.subject) { sql += ' AND subject = ?'; params.push(query.subject); }
    if (query.predicate) { sql += ' AND predicate = ?'; params.push(query.predicate); }
    if (query.object) { sql += ' AND object = ?'; params.push(query.object); }
    if (query.namespace) { sql += ' AND namespace = ?'; params.push(query.namespace); }

    sql += ' ORDER BY confidence DESC';

    const rows = this.db.prepare(sql).all(...params) as FactRow[];
    return rows.map(rowToFact);
  }

  async storePreference(
    pref: Omit<UserPreference, 'id' | 'updatedAt'>,
  ): Promise<string> {
    const now = new Date().toISOString();

    // Check for existing preference
    const existing = this.db.prepare(
      'SELECT id FROM user_preferences WHERE owner_id = ? AND category = ? AND key = ?',
    ).get(pref.ownerId, pref.category, pref.key) as { id: string } | undefined;

    if (existing) {
      this.db.prepare(`
        UPDATE user_preferences SET value = ?, confidence = ?, source = ?, updated_at = ? WHERE id = ?
      `).run(JSON.stringify(pref.value), pref.confidence, pref.source, now, existing.id);
      return existing.id;
    }

    const id = generateId();
    this.db.prepare(`
      INSERT INTO user_preferences (id, owner_id, category, key, value, confidence, source, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, pref.ownerId, pref.category, pref.key, JSON.stringify(pref.value), pref.confidence, pref.source, now);
    return id;
  }

  async getPreferences(ownerId: string, category?: string): Promise<UserPreference[]> {
    let sql = 'SELECT * FROM user_preferences WHERE owner_id = ?';
    const params: string[] = [ownerId];

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }

    const rows = this.db.prepare(sql).all(...params) as PrefRow[];
    return rows.map(rowToPref);
  }

  // =====================================================================
  // Procedural Memory
  // =====================================================================

  async recordProcedure(
    pattern: Omit<ProceduralPattern, 'id' | 'successRate' | 'usageCount' | 'createdAt' | 'lastUsedAt'>,
  ): Promise<string> {
    const id = generateId();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO procedural_patterns (id, name, goal_pattern, tool_sequence, success_rate, avg_duration_ms, usage_count, preconditions, created_at, last_used_at)
      VALUES (?, ?, ?, ?, 1.0, ?, 1, ?, ?, ?)
    `).run(
      id,
      pattern.name,
      pattern.goalPattern,
      JSON.stringify(pattern.toolSequence),
      pattern.avgDurationMs,
      pattern.preconditions ? JSON.stringify(pattern.preconditions) : null,
      now,
      now,
    );

    logger.debug(`Recorded procedure: ${pattern.name}`);
    return id;
  }

  async findProcedures(goal: string, topK: number = 3): Promise<ProceduralPattern[]> {
    // Simple text matching; production should use embeddings
    const escaped = goal.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    const rows = this.db.prepare(`
      SELECT * FROM procedural_patterns
      WHERE goal_pattern LIKE ?
      ORDER BY success_rate DESC, usage_count DESC
      LIMIT ?
    `).all(`%${escaped}%`, topK) as ProcRow[];

    return rows.map(rowToProc);
  }

  async updateProcedureStats(patternId: string, success: boolean, durationMs: number): Promise<void> {
    const row = this.db.prepare('SELECT usage_count, success_rate, avg_duration_ms FROM procedural_patterns WHERE id = ?')
      .get(patternId) as { usage_count: number; success_rate: number; avg_duration_ms: number } | undefined;

    if (!row) return;

    const newCount = row.usage_count + 1;
    const newSuccessRate = ((row.success_rate * row.usage_count) + (success ? 1 : 0)) / newCount;
    const newAvgDuration = ((row.avg_duration_ms * row.usage_count) + durationMs) / newCount;

    this.db.prepare(`
      UPDATE procedural_patterns
      SET usage_count = ?, success_rate = ?, avg_duration_ms = ?, last_used_at = ?
      WHERE id = ?
    `).run(newCount, newSuccessRate, newAvgDuration, new Date().toISOString(), patternId);
  }

  // =====================================================================
  // Memory Consolidation & Decay
  // =====================================================================

  async consolidate(agentId: string): Promise<ConsolidationResult> {
    logger.info(`Starting memory consolidation for agent ${agentId}`);

    const result: ConsolidationResult = {
      factsExtracted: 0,
      patternsDiscovered: 0,
      memoriesForgotten: 0,
      episodesProcessed: 0,
    };

    // 1. Get recent unprocessed episodes
    const episodes = this.db.prepare(`
      SELECT * FROM episodic_memory
      WHERE agent_id = ? AND outcome = 'success'
      ORDER BY created_at DESC
      LIMIT 50
    `).all(agentId) as EpisodicRow[];

    result.episodesProcessed = episodes.length;

    // 2. Extract tool sequences from successful episodes as procedural patterns
    for (const ep of episodes) {
      try {
        const context = JSON.parse(ep.context) as EpisodicMemory['context'];
        if (context.toolsUsed && context.toolsUsed.length >= 2) {
          // Check if a similar pattern already exists
          const existingPatterns = await this.findProcedures(ep.summary, 1);
          if (existingPatterns.length === 0) {
            await this.recordProcedure({
              name: `auto-${ep.event_type}`,
              goalPattern: ep.summary,
              toolSequence: context.toolsUsed.map((tool, i) => ({
                order: i,
                toolOrAgent: tool,
              })),
              avgDurationMs: 0,
            });
            result.patternsDiscovered++;
          }
        }
      } catch (error) {
        logger.warn(`Skipping episode ${ep.id} during consolidation: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 3. Decay old memories
    result.memoriesForgotten = await this.decay({ agentId });

    logger.info(`Consolidation complete: ${JSON.stringify(result)}`);
    return result;
  }

  async decay(options: DecayOptions = {}): Promise<number> {
    const factor = options.decayFactor ?? this.decayFactor;
    const minImp = options.minImportance ?? this.minImportance;

    let sql = 'UPDATE episodic_memory SET importance = importance * ? WHERE 1=1';
    const params: unknown[] = [factor];

    if (options.agentId) {
      sql += ' AND agent_id = ?';
      params.push(options.agentId);
    }

    this.db.prepare(sql).run(...params);

    // Remove memories below threshold
    let deleteSql = 'DELETE FROM episodic_memory WHERE importance < ?';
    const deleteParams: unknown[] = [minImp];

    if (options.agentId) {
      deleteSql += ' AND agent_id = ?';
      deleteParams.push(options.agentId);
    }

    const deleteResult = this.db.prepare(deleteSql).run(...deleteParams);
    const forgotten = deleteResult.changes;

    if (forgotten > 0) {
      logger.info(`Memory decay: ${forgotten} memories forgotten (below threshold ${minImp})`);
    }

    return forgotten;
  }

  /** 关闭数据库连接 */
  close(): void {
    this.db.close();
  }
}

// =====================================================================
// Row types and converters
// =====================================================================

interface EpisodicRow {
  id: string;
  agent_id: string;
  event_type: string;
  summary: string;
  context: string;
  outcome: string;
  lessons: string | null;
  importance: number;
  last_accessed_at: string;
  access_count: number;
  created_at: string;
}

function rowToEpisodic(row: EpisodicRow): EpisodicMemory {
  return {
    id: row.id,
    agentId: row.agent_id,
    eventType: row.event_type as EpisodicMemory['eventType'],
    summary: row.summary,
    context: JSON.parse(row.context),
    outcome: row.outcome as EpisodicMemory['outcome'],
    lessons: row.lessons ? JSON.parse(row.lessons) : undefined,
    importance: row.importance,
    lastAccessedAt: new Date(row.last_accessed_at),
    accessCount: row.access_count,
    createdAt: new Date(row.created_at),
  };
}

interface FactRow {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  source_episode_ids: string;
  namespace: string;
  created_at: string;
  last_verified_at: string;
}

function rowToFact(row: FactRow): SemanticFact {
  return {
    id: row.id,
    subject: row.subject,
    predicate: row.predicate,
    object: row.object,
    confidence: row.confidence,
    sourceEpisodeIds: JSON.parse(row.source_episode_ids),
    namespace: row.namespace,
    createdAt: new Date(row.created_at),
    lastVerifiedAt: new Date(row.last_verified_at),
  };
}

interface PrefRow {
  id: string;
  owner_id: string;
  category: string;
  key: string;
  value: string;
  confidence: number;
  source: string;
  updated_at: string;
}

function rowToPref(row: PrefRow): UserPreference {
  return {
    id: row.id,
    ownerId: row.owner_id,
    category: row.category,
    key: row.key,
    value: JSON.parse(row.value),
    confidence: row.confidence,
    source: row.source as 'explicit' | 'inferred',
    updatedAt: new Date(row.updated_at),
  };
}

interface ProcRow {
  id: string;
  name: string;
  goal_pattern: string;
  tool_sequence: string;
  success_rate: number;
  avg_duration_ms: number;
  usage_count: number;
  preconditions: string | null;
  created_at: string;
  last_used_at: string;
}

function rowToProc(row: ProcRow): ProceduralPattern {
  return {
    id: row.id,
    name: row.name,
    goalPattern: row.goal_pattern,
    toolSequence: JSON.parse(row.tool_sequence),
    successRate: row.success_rate,
    avgDurationMs: row.avg_duration_ms,
    usageCount: row.usage_count,
    preconditions: row.preconditions ? JSON.parse(row.preconditions) : undefined,
    createdAt: new Date(row.created_at),
    lastUsedAt: new Date(row.last_used_at),
  };
}
