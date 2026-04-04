/**
 * Event normalizer - transforms platform-specific events into unified TriggerEvent format
 */

import type {
  PlatformType,
  TriggerEvent,
  TriggerEventSource,
} from '@thematrix/types';
import { generateId } from '@thematrix/utils';

/**
 * Create a normalized TriggerEvent from platform-specific data.
 */
export function createTriggerEvent(
  platform: PlatformType,
  eventType: string,
  source: TriggerEventSource,
  payload: Record<string, unknown>,
  rawPayload: unknown,
  metadata?: Record<string, string>,
): TriggerEvent {
  return {
    id: generateId(),
    platform,
    eventType,
    source,
    payload,
    rawPayload,
    timestamp: new Date(),
    metadata: metadata ?? extractMetadata(platform, eventType, source, payload),
  };
}

/**
 * Extract searchable metadata fields from the event for trigger rule matching.
 */
function extractMetadata(
  platform: PlatformType,
  eventType: string,
  source: TriggerEventSource,
  payload: Record<string, unknown>,
): Record<string, string> {
  const metadata: Record<string, string> = {
    platform,
    eventType,
  };

  if (source.project) metadata['source.project'] = source.project;
  if (source.repository) metadata['source.repository'] = source.repository;
  if (source.branch) metadata['source.branch'] = source.branch;
  if (source.author) metadata['source.author'] = source.author;
  if (source.channel) metadata['source.channel'] = source.channel;

  // Flatten top-level string payload fields into metadata
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string') {
      metadata[`payload.${key}`] = value;
    }
  }

  return metadata;
}

/**
 * Resolve a simple dot-path from an object (e.g., "change.project" from a nested object).
 * This is a lightweight alternative to full JSONPath for common use cases.
 */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function resolvePath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }
    if (DANGEROUS_KEYS.has(part)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}
