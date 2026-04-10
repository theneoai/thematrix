/**
 * Monitor API Authentication Middleware
 *
 * Provides API key-based authentication for the Monitor REST API.
 *
 * Supports three modes:
 *   - 'none':    No authentication (development default)
 *   - 'api-key': Static API key validated via Bearer token or X-API-Key header
 *   - 'multi-key': Multiple named API keys with role-based access control
 *
 * Usage:
 *   const auth = new AuthMiddleware({ mode: 'api-key', apiKey: process.env.MONITOR_API_KEY });
 *   if (!auth.authenticate(req)) { res.writeHead(401); return; }
 */

import type { IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'AuthMiddleware' });

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type AuthMode = 'none' | 'api-key' | 'multi-key';

export type ApiKeyRole = 'admin' | 'developer' | 'viewer';

export interface ApiKeyEntry {
  key: string;
  role: ApiKeyRole;
  name: string;
  /** Optional IP allowlist — if set, key is only valid from these IPs */
  allowedIps?: string[];
}

export interface AuthConfig {
  /** Authentication mode. Default: 'none' (no auth). */
  mode: AuthMode;
  /**
   * Single static API key (used when mode='api-key').
   * Can be a raw string or read from env: { env: 'MONITOR_API_KEY' }
   */
  apiKey?: string | { env: string };
  /** Multiple named API keys with roles (used when mode='multi-key'). */
  apiKeys?: ApiKeyEntry[];
  /**
   * Paths that bypass authentication entirely.
   * Defaults to ['/health', '/metrics'].
   */
  publicPaths?: string[];
}

export interface AuthResult {
  authenticated: boolean;
  role?: ApiKeyRole;
  keyName?: string;
  reason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// AuthMiddleware
// ─────────────────────────────────────────────────────────────────────────────

export class AuthMiddleware {
  private readonly mode: AuthMode;
  private readonly singleKey?: Buffer;
  private readonly multiKeys: ApiKeyEntry[];
  private readonly publicPaths: Set<string>;

  constructor(config: AuthConfig) {
    this.mode = config.mode;
    this.publicPaths = new Set(config.publicPaths ?? ['/health', '/metrics']);

    if (config.mode === 'api-key') {
      const rawKey = typeof config.apiKey === 'object' && config.apiKey.env
        ? process.env[config.apiKey.env]
        : config.apiKey as string | undefined;

      if (!rawKey) {
        throw new Error(
          'AuthMiddleware: mode is "api-key" but no apiKey was provided. ' +
          'Set config.apiKey or the referenced environment variable.',
        );
      }
      this.singleKey = Buffer.from(rawKey, 'utf8');
    }

    this.multiKeys = config.apiKeys ?? [];

    if (config.mode === 'multi-key' && this.multiKeys.length === 0) {
      throw new Error('AuthMiddleware: mode is "multi-key" but no apiKeys were provided.');
    }
  }

  /**
   * Authenticate an incoming HTTP request.
   *
   * Reads the API key from:
   *   1. Authorization header: `Bearer <key>`
   *   2. X-API-Key header: `<key>`
   */
  authenticate(req: IncomingMessage): AuthResult {
    const url = req.url ?? '/';
    // Strip query string for path matching
    const path = url.split('?')[0];

    // Public paths bypass authentication
    if (this.publicPaths.has(path)) {
      return { authenticated: true, role: 'viewer' };
    }

    if (this.mode === 'none') {
      return { authenticated: true, role: 'admin' };
    }

    const providedKey = this.extractKey(req);
    if (!providedKey) {
      return {
        authenticated: false,
        reason: 'Missing API key. Provide via "Authorization: Bearer <key>" or "X-API-Key: <key>" header.',
      };
    }

    if (this.mode === 'api-key') {
      return this.authenticateSingleKey(providedKey);
    }

    if (this.mode === 'multi-key') {
      const clientIp = this.extractIp(req);
      return this.authenticateMultiKey(providedKey, clientIp);
    }

    return { authenticated: false, reason: 'Unknown auth mode' };
  }

  /**
   * Send a 401 Unauthorized response.
   */
  sendUnauthorized(
    res: import('node:http').ServerResponse,
    reason = 'Unauthorized',
  ): void {
    res.writeHead(401, {
      'Content-Type': 'application/json',
      'WWW-Authenticate': 'Bearer realm="TheMatrix Monitor API"',
    });
    res.end(JSON.stringify({ error: 'Unauthorized', message: reason }));
  }

  /**
   * Send a 403 Forbidden response (authenticated but insufficient role).
   */
  sendForbidden(
    res: import('node:http').ServerResponse,
    required: ApiKeyRole,
    actual: ApiKeyRole,
  ): void {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Forbidden',
      message: `Insufficient role: required "${required}", got "${actual}"`,
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private extractKey(req: IncomingMessage): string | null {
    const authHeader = req.headers['authorization'];
    if (authHeader) {
      const match = /^Bearer\s+(.+)$/i.exec(authHeader as string);
      if (match) return match[1].trim();
    }

    const apiKeyHeader = req.headers['x-api-key'];
    if (apiKeyHeader) {
      return (Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader).trim();
    }

    return null;
  }

  private extractIp(req: IncomingMessage): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
      return first.split(',')[0].trim();
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  private authenticateSingleKey(providedKey: string): AuthResult {
    const provided = Buffer.from(providedKey, 'utf8');
    const expected = this.singleKey!;

    // Use timing-safe comparison to prevent timing attacks
    if (provided.length !== expected.length) {
      logger.warn('API key authentication failed: length mismatch');
      return { authenticated: false, reason: 'Invalid API key' };
    }

    if (!timingSafeEqual(provided, expected)) {
      logger.warn('API key authentication failed: key mismatch');
      return { authenticated: false, reason: 'Invalid API key' };
    }

    return { authenticated: true, role: 'admin', keyName: 'default' };
  }

  private authenticateMultiKey(providedKey: string, clientIp: string): AuthResult {
    const providedBuf = Buffer.from(providedKey, 'utf8');

    for (const entry of this.multiKeys) {
      const entryBuf = Buffer.from(entry.key, 'utf8');
      if (providedBuf.length !== entryBuf.length) continue;
      if (!timingSafeEqual(providedBuf, entryBuf)) continue;

      // Key matched — check IP allowlist if configured
      if (entry.allowedIps && entry.allowedIps.length > 0) {
        if (!entry.allowedIps.includes(clientIp)) {
          logger.warn(`API key "${entry.name}" matched but IP "${clientIp}" is not in allowlist`);
          return { authenticated: false, reason: 'IP not in allowlist for this API key' };
        }
      }

      logger.debug(`Authenticated with key "${entry.name}" (role: ${entry.role})`);
      return { authenticated: true, role: entry.role, keyName: entry.name };
    }

    logger.warn('API key authentication failed: no matching key found');
    return { authenticated: false, reason: 'Invalid API key' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Role-based access control helpers
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_HIERARCHY: Record<ApiKeyRole, number> = {
  viewer: 0,
  developer: 1,
  admin: 2,
};

/**
 * Returns true if `actual` role has at least the permissions of `required` role.
 */
export function hasRole(actual: ApiKeyRole, required: ApiKeyRole): boolean {
  return ROLE_HIERARCHY[actual] >= ROLE_HIERARCHY[required];
}

/**
 * HTTP methods that require at minimum "developer" role (write operations).
 */
export const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
