/**
 * Workflow Checkpoint Store — durable checkpointing for fault-tolerant workflows
 *
 * Persists workflow state to SQLite so long-running workflows can be resumed
 * after node failures, K8s pod eviction, or process restarts.
 */
import type { WorkflowCheckpoint, ICheckpointStore } from '@thematrix/types';
import { Logger, generateId } from '@thematrix/utils';
import Database from 'better-sqlite3';

const logger = new Logger({ prefix: 'CheckpointStore' });

export class SqliteCheckpointStore implements ICheckpointStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    this.db = new Database(dbPath ?? ':memory:');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_checkpoints (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL UNIQUE,
        workflow_id TEXT NOT NULL,
        completed_nodes TEXT NOT NULL DEFAULT '[]',
        node_outputs TEXT NOT NULL DEFAULT '{}',
        variables TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_checkpoint_run ON workflow_checkpoints(run_id);
    `);
    logger.info('Checkpoint store schema initialized');
  }

  async save(checkpoint: WorkflowCheckpoint): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO workflow_checkpoints (id, run_id, workflow_id, completed_nodes, node_outputs, variables, created_at, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        completed_nodes = excluded.completed_nodes,
        node_outputs = excluded.node_outputs,
        variables = excluded.variables,
        created_at = excluded.created_at,
        version = excluded.version
    `);

    stmt.run(
      checkpoint.id,
      checkpoint.runId,
      checkpoint.workflowId,
      JSON.stringify(checkpoint.completedNodes),
      JSON.stringify(checkpoint.nodeOutputs),
      JSON.stringify(checkpoint.variables),
      checkpoint.createdAt.toISOString(),
      checkpoint.version,
    );

    logger.debug(`Checkpoint saved for run ${checkpoint.runId} (version ${checkpoint.version})`);
  }

  async load(runId: string): Promise<WorkflowCheckpoint | undefined> {
    const row = this.db.prepare(
      'SELECT * FROM workflow_checkpoints WHERE run_id = ?',
    ).get(runId) as CheckpointRow | undefined;

    if (!row) return undefined;
    return rowToCheckpoint(row);
  }

  async delete(runId: string): Promise<void> {
    this.db.prepare('DELETE FROM workflow_checkpoints WHERE run_id = ?').run(runId);
    logger.debug(`Checkpoint deleted for run ${runId}`);
  }

  async listActive(): Promise<WorkflowCheckpoint[]> {
    const rows = this.db.prepare(
      'SELECT * FROM workflow_checkpoints ORDER BY created_at DESC',
    ).all() as CheckpointRow[];
    return rows.map(rowToCheckpoint);
  }

  close(): void {
    this.db.close();
  }
}

interface CheckpointRow {
  id: string;
  run_id: string;
  workflow_id: string;
  completed_nodes: string;
  node_outputs: string;
  variables: string;
  created_at: string;
  version: number;
}

function rowToCheckpoint(row: CheckpointRow): WorkflowCheckpoint {
  return {
    id: row.id,
    runId: row.run_id,
    workflowId: row.workflow_id,
    completedNodes: JSON.parse(row.completed_nodes),
    nodeOutputs: JSON.parse(row.node_outputs),
    variables: JSON.parse(row.variables),
    createdAt: new Date(row.created_at),
    version: row.version,
  };
}
