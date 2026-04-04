/**
 * Event Store - SQLite 持久化存储
 */
import Database from 'better-sqlite3';
import type { DomainEvent, EventFilter, IEventStore } from '@thematrix/types';
import { Logger, generateEventId } from '@thematrix/utils';

const logger = new Logger({ prefix: 'EventStore' });

export class SQLiteEventStore implements IEventStore {
  private db: Database.Database;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        event_id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        source_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        payload TEXT NOT NULL,
        correlation_id TEXT NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
      CREATE INDEX IF NOT EXISTS idx_events_source ON events(source_kind, source_id);
      CREATE INDEX IF NOT EXISTS idx_events_correlation ON events(correlation_id);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
    `);
    logger.info('Event store initialized');
  }

  async append(event: DomainEvent): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO events (event_id, type, source_kind, source_id, timestamp, payload, correlation_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      event.eventId,
      event.type,
      event.source.kind,
      event.source.id,
      event.timestamp.toISOString(),
      JSON.stringify(event.payload),
      event.correlationId
    );
  }

  async getEvents(filter?: EventFilter, limit?: number): Promise<DomainEvent[]> {
    let sql = 'SELECT * FROM events WHERE 1=1';
    const params: (string | number)[] = [];

    if (filter?.type) {
      sql += ' AND type = ?';
      params.push(filter.type);
    }
    if (filter?.sourceKind) {
      sql += ' AND source_kind = ?';
      params.push(filter.sourceKind);
    }
    if (filter?.sourceId) {
      sql += ' AND source_id = ?';
      params.push(filter.sourceId);
    }
    if (filter?.correlationId) {
      sql += ' AND correlation_id = ?';
      params.push(filter.correlationId);
    }
    if (filter?.fromTimestamp) {
      sql += ' AND timestamp >= ?';
      params.push(filter.fromTimestamp.toISOString());
    }
    if (filter?.toTimestamp) {
      sql += ' AND timestamp <= ?';
      params.push(filter.toTimestamp.toISOString());
    }

    sql += ' ORDER BY timestamp ASC';

    if (limit) {
      sql += ' LIMIT ?';
      params.push(limit);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as EventRow[];
    return rows.map(rowToEvent);
  }

  async getEventById(eventId: string): Promise<DomainEvent | undefined> {
    const stmt = this.db.prepare('SELECT * FROM events WHERE event_id = ?');
    const row = stmt.get(eventId) as EventRow | undefined;
    return row ? rowToEvent(row) : undefined;
  }

  async getEventsAfter(eventId: string, filter?: EventFilter): Promise<DomainEvent[]> {
    // Use rowid-based pagination to avoid missing same-millisecond events
    const rowStmt = this.db.prepare('SELECT rowid FROM events WHERE event_id = ?');
    const rowRow = rowStmt.get(eventId) as { rowid: number } | undefined;
    if (!rowRow) return [];

    let sql = 'SELECT * FROM events WHERE rowid > ?';
    const params: (string | number)[] = [rowRow.rowid];

    if (filter?.type) {
      sql += ' AND type = ?';
      params.push(filter.type);
    }
    if (filter?.sourceKind) {
      sql += ' AND source_kind = ?';
      params.push(filter.sourceKind);
    }
    if (filter?.sourceId) {
      sql += ' AND source_id = ?';
      params.push(filter.sourceId);
    }
    if (filter?.correlationId) {
      sql += ' AND correlation_id = ?';
      params.push(filter.correlationId);
    }
    if (filter?.toTimestamp) {
      sql += ' AND timestamp <= ?';
      params.push(filter.toTimestamp.toISOString());
    }

    sql += ' ORDER BY rowid ASC';

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as EventRow[];
    return rows.map(rowToEvent);
  }

  close(): void {
    this.db.close();
  }
}

interface EventRow {
  event_id: string;
  type: string;
  source_kind: 'agent' | 'workflow' | 'system';
  source_id: string;
  timestamp: string;
  payload: string;
  correlation_id: string;
}

function rowToEvent(row: EventRow): DomainEvent {
  return {
    eventId: row.event_id,
    type: row.type,
    source: {
      kind: row.source_kind,
      id: row.source_id,
    },
    timestamp: new Date(row.timestamp),
    payload: JSON.parse(row.payload),
    correlationId: row.correlation_id,
  };
}
