/**
 * Memory Manager - 内存管理实现
 */
import type {
  IMemoryManager,
  MemoryScope,
  MemoryEntry,
  VectorMemoryEntry,
  ConversationTurn,
  IVectorStore,
  IEmbeddingProvider,
} from '@thematrix/types';
import { Logger, generateId } from '@thematrix/utils';
import Database from 'better-sqlite3';

const logger = new Logger({ prefix: 'MemoryManager' });

export interface MemoryManagerOptions {
  dbPath?: string;
  vectorStore?: IVectorStore;
  embeddingProvider?: IEmbeddingProvider;
}

export class MemoryManager implements IMemoryManager {
  private db: Database.Database;
  private vectorStore?: IVectorStore;
  private embeddingProvider?: IEmbeddingProvider;

  constructor(options: MemoryManagerOptions = {}) {
    this.db = new Database(options.dbPath ?? ':memory:');
    this.vectorStore = options.vectorStore;
    this.embeddingProvider = options.embeddingProvider;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      -- KV Store
      CREATE TABLE IF NOT EXISTS kv_store (
        scope TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        PRIMARY KEY (scope, owner_id, key)
      );
      
      CREATE INDEX IF NOT EXISTS idx_kv_scope ON kv_store(scope, owner_id);
      CREATE INDEX IF NOT EXISTS idx_kv_expires ON kv_store(expires_at);
      
      -- Conversation History
      CREATE TABLE IF NOT EXISTS conversation_history (
        turn_id TEXT PRIMARY KEY,
        agent_instance_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls TEXT,
        tool_results TEXT,
        timestamp TEXT NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_conv_agent ON conversation_history(agent_instance_id, timestamp);
    `);
    logger.info('Memory manager initialized');
  }

  // KV Store
  async get(scope: MemoryScope, ownerId: string, key: string): Promise<unknown | undefined> {
    this.cleanupExpired();
    
    const stmt = this.db.prepare(
      'SELECT value FROM kv_store WHERE scope = ? AND owner_id = ? AND key = ?'
    );
    const row = stmt.get(scope, ownerId, key) as { value: string } | undefined;
    
    return row ? JSON.parse(row.value) : undefined;
  }

  async set(
    scope: MemoryScope, 
    ownerId: string, 
    key: string, 
    value: unknown, 
    ttlMs?: number
  ): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO kv_store (scope, owner_id, key, value, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const now = new Date();
    const expiresAt = ttlMs ? new Date(now.getTime() + ttlMs) : null;
    
    stmt.run(
      scope,
      ownerId,
      key,
      JSON.stringify(value),
      now.toISOString(),
      expiresAt?.toISOString() ?? null
    );
  }

  async delete(scope: MemoryScope, ownerId: string, key: string): Promise<boolean> {
    const stmt = this.db.prepare(
      'DELETE FROM kv_store WHERE scope = ? AND owner_id = ? AND key = ?'
    );
    const result = stmt.run(scope, ownerId, key);
    return result.changes > 0;
  }

  async list(scope: MemoryScope, ownerId: string, prefix?: string): Promise<MemoryEntry[]> {
    this.cleanupExpired();

    let sql = 'SELECT * FROM kv_store WHERE scope = ? AND owner_id = ?';
    const params: (string | MemoryScope)[] = [scope, ownerId];

    if (prefix) {
      // Escape SQL LIKE wildcards in the prefix to prevent unintended wildcard matching
      const escapedPrefix = prefix.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      sql += ' AND key LIKE ? ESCAPE \'\\\'';
      params.push(`${escapedPrefix}%`);
    }

    sql += ' ORDER BY key';
    
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as KVRow[];
    
    return rows.map(row => ({
      key: row.key,
      value: JSON.parse(row.value),
      createdAt: new Date(row.created_at),
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
    }));
  }

  // Vector Memory
  async embed(
    scope: MemoryScope,
    ownerId: string,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<string> {
    // If vector store and embedding provider are available, use real vector storage
    if (this.vectorStore && this.embeddingProvider) {
      const collectionName = `${scope}:${ownerId}`;
      const id = generateId();

      // Ensure collection exists (idempotent)
      try {
        await this.vectorStore.createCollection(collectionName, this.embeddingProvider.dimension);
      } catch {
        // Collection may already exist
      }

      const [embedding] = await this.embeddingProvider.embed([content]);
      await this.vectorStore.upsert(collectionName, [
        {
          id,
          content,
          embedding,
          metadata: metadata ?? {},
        },
      ]);
      return id;
    }

    // Fallback: stores as regular KV
    const id = `vec-${Date.now()}`;
    await this.set(scope, ownerId, `__vec_${id}`, {
      content,
      metadata,
      embeddedAt: new Date().toISOString(),
    });
    return id;
  }

  async search(
    scope: MemoryScope,
    ownerId: string,
    query: string,
    topK: number = 5
  ): Promise<VectorMemoryEntry[]> {
    // If vector store and embedding provider are available, use real vector search
    if (this.vectorStore && this.embeddingProvider) {
      const collectionName = `${scope}:${ownerId}`;
      const [queryEmbedding] = await this.embeddingProvider.embed([query]);

      try {
        const results = await this.vectorStore.query(collectionName, queryEmbedding, topK);
        return results.map(r => ({
          id: r.id,
          content: r.content,
          embedding: [],
          metadata: r.metadata,
          score: r.score,
        }));
      } catch {
        // Collection may not exist yet
        return [];
      }
    }

    // Fallback: simple text search
    const entries = await this.list(scope, ownerId, '__vec_');

    return entries.slice(0, topK).map(entry => ({
      id: entry.key.replace('__vec_', ''),
      content: (entry.value as { content: string }).content,
      embedding: [],
      metadata: (entry.value as { metadata?: Record<string, unknown> }).metadata ?? {},
    }));
  }

  // Conversation History
  async appendTurn(agentInstanceId: string, turn: ConversationTurn): Promise<string> {
    const stmt = this.db.prepare(`
      INSERT INTO conversation_history 
      (turn_id, agent_instance_id, role, content, tool_calls, tool_results, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      turn.turnId,
      agentInstanceId,
      turn.role,
      turn.content,
      turn.toolCalls ? JSON.stringify(turn.toolCalls) : null,
      turn.toolResults ? JSON.stringify(turn.toolResults) : null,
      turn.timestamp.toISOString()
    );
    
    return turn.turnId;
  }

  async getHistory(agentInstanceId: string, limit?: number): Promise<ConversationTurn[]> {
    let sql = `
      SELECT * FROM conversation_history
      WHERE agent_instance_id = ?
      ORDER BY rowid ASC
    `;
    const params: (string | number)[] = [agentInstanceId];
    
    if (limit) {
      sql += ' LIMIT ?';
      params.push(limit);
    }
    
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as ConversationRow[];
    
    return rows.map(row => {
      let toolCalls;
      let toolResults;
      try {
        toolCalls = row.tool_calls ? JSON.parse(row.tool_calls) : undefined;
      } catch {
        logger.warn(`Failed to parse toolCalls for turn ${row.turn_id}`);
      }
      try {
        toolResults = row.tool_results ? JSON.parse(row.tool_results) : undefined;
      } catch {
        logger.warn(`Failed to parse toolResults for turn ${row.turn_id}`);
      }
      return {
        turnId: row.turn_id,
        role: row.role as ConversationTurn['role'],
        content: row.content,
        toolCalls,
        toolResults,
        timestamp: new Date(row.timestamp),
      };
    });
  }

  async clearHistory(agentInstanceId: string): Promise<void> {
    const stmt = this.db.prepare(
      'DELETE FROM conversation_history WHERE agent_instance_id = ?'
    );
    stmt.run(agentInstanceId);
  }

  private cleanupExpired(): void {
    const stmt = this.db.prepare(
      'DELETE FROM kv_store WHERE expires_at IS NOT NULL AND expires_at < ?'
    );
    stmt.run(new Date().toISOString());
  }

  close(): void {
    this.db.close();
  }
}

interface KVRow {
  scope: string;
  owner_id: string;
  key: string;
  value: string;
  created_at: string;
  expires_at: string | null;
}

interface ConversationRow {
  turn_id: string;
  agent_instance_id: string;
  role: string;
  content: string;
  tool_calls: string | null;
  tool_results: string | null;
  timestamp: string;
}
