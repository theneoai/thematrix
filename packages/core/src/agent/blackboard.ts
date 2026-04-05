/**
 * Shared Blackboard - Multi-agent collaborative workspace
 *
 * Implements the blackboard architectural pattern for agent coordination.
 * Agents can post observations, hypotheses, and decisions that other agents
 * can read and react to — enabling emergent collaboration without tight coupling.
 */
import type { DomainEvent, IEventBus } from '@thematrix/types';
import { EventTypes } from '@thematrix/types';
import { Logger, generateId } from '@thematrix/utils';

const logger = new Logger({ prefix: 'Blackboard' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BlackboardEntryType =
  | 'observation'
  | 'hypothesis'
  | 'decision'
  | 'artifact'
  | 'question'
  | 'answer';

export interface BlackboardEntry {
  id: string;
  workflowRunId: string;
  agentId: string;
  type: BlackboardEntryType;
  content: string;
  data?: Record<string, unknown>;
  tags?: string[];
  confidence?: number; // 0-1
  timestamp: Date;
  referencesEntryId?: string; // for threading
}

export interface BlackboardFilter {
  workflowRunId?: string;
  agentId?: string;
  type?: BlackboardEntryType;
  tags?: string[]; // match any
  since?: Date;
  referencesEntryId?: string;
}

// ---------------------------------------------------------------------------
// Blackboard event type (extends EventTypes at runtime)
// ---------------------------------------------------------------------------

const BLACKBOARD_ENTRY_POSTED = 'blackboard.entry.posted';

// ---------------------------------------------------------------------------
// Blackboard
// ---------------------------------------------------------------------------

export class Blackboard {
  private entries: BlackboardEntry[] = [];
  private subscribers: Array<{
    filter: BlackboardFilter;
    handler: (entry: BlackboardEntry) => void;
  }> = [];
  private eventBus: IEventBus;

  constructor(eventBus: IEventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Post a new entry to the blackboard.
   * Assigns an `id` and `timestamp` if not already present, notifies
   * matching subscribers, and publishes a domain event.
   */
  post(entry: BlackboardEntry): void {
    // Ensure defaults
    if (!entry.id) {
      entry.id = generateId();
    }
    if (!entry.timestamp) {
      entry.timestamp = new Date();
    }

    this.entries.push(entry);

    logger.debug(
      `Entry posted [${entry.type}] by agent=${entry.agentId}: ${entry.content.slice(0, 80)}`,
    );

    // Notify local subscribers
    for (const sub of this.subscribers) {
      if (this.matchesFilter(entry, sub.filter)) {
        try {
          sub.handler(entry);
        } catch (err) {
          logger.warn(`Subscriber handler threw: ${(err as Error).message}`);
        }
      }
    }

    // Publish domain event (fire-and-forget)
    const event: DomainEvent<{ entry: BlackboardEntry }> = {
      eventId: generateId(),
      type: BLACKBOARD_ENTRY_POSTED,
      source: { kind: 'workflow', id: entry.workflowRunId },
      timestamp: new Date(),
      payload: { entry },
      correlationId: entry.workflowRunId,
    };

    this.eventBus.publish(event).catch((err) => {
      logger.warn(`Failed to publish blackboard event: ${(err as Error).message}`);
    });
  }

  /**
   * Query entries matching the supplied filter.
   * All filter fields are optional — omitted fields match everything.
   */
  query(filter: BlackboardFilter): BlackboardEntry[] {
    return this.entries.filter((e) => this.matchesFilter(e, filter));
  }

  /**
   * Subscribe to new entries matching a filter.
   * Returns an unsubscribe function.
   */
  subscribe(
    filter: BlackboardFilter,
    handler: (entry: BlackboardEntry) => void,
  ): () => void {
    const sub = { filter, handler };
    this.subscribers.push(sub);
    return () => {
      const idx = this.subscribers.indexOf(sub);
      if (idx !== -1) {
        this.subscribers.splice(idx, 1);
      }
    };
  }

  /**
   * Get the most recent entry from a specific agent, optionally filtered by type.
   */
  getLatest(agentId: string, type?: string): BlackboardEntry | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (entry.agentId === agentId && (!type || entry.type === type)) {
        return entry;
      }
    }
    return undefined;
  }

  /**
   * Generate a textual summary of all entries suitable for injection into an
   * LLM context window. Groups entries chronologically with metadata.
   */
  getSummary(): string {
    if (this.entries.length === 0) {
      return '(blackboard is empty)';
    }

    const lines: string[] = ['=== Shared Blackboard ===', ''];

    for (const entry of this.entries) {
      const ts = entry.timestamp.toISOString();
      const conf =
        entry.confidence !== undefined ? ` (confidence: ${entry.confidence})` : '';
      const tags = entry.tags && entry.tags.length > 0 ? ` [${entry.tags.join(', ')}]` : '';
      const ref = entry.referencesEntryId ? ` (re: ${entry.referencesEntryId})` : '';

      lines.push(`[${ts}] ${entry.agentId} — ${entry.type.toUpperCase()}${conf}${tags}${ref}`);
      lines.push(`  ${entry.content}`);
      if (entry.data && Object.keys(entry.data).length > 0) {
        lines.push(`  data: ${JSON.stringify(entry.data)}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Remove all entries and subscribers.
   */
  clear(): void {
    this.entries = [];
    this.subscribers = [];
    logger.debug('Blackboard cleared');
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private matchesFilter(entry: BlackboardEntry, filter: BlackboardFilter): boolean {
    if (filter.workflowRunId && entry.workflowRunId !== filter.workflowRunId) {
      return false;
    }
    if (filter.agentId && entry.agentId !== filter.agentId) {
      return false;
    }
    if (filter.type && entry.type !== filter.type) {
      return false;
    }
    if (filter.referencesEntryId && entry.referencesEntryId !== filter.referencesEntryId) {
      return false;
    }
    if (filter.since && entry.timestamp < filter.since) {
      return false;
    }
    if (filter.tags && filter.tags.length > 0) {
      const entryTags = entry.tags ?? [];
      const hasAny = filter.tags.some((t) => entryTags.includes(t));
      if (!hasAny) {
        return false;
      }
    }
    return true;
  }
}
