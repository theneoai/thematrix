/**
 * SSE (Server-Sent Events) streaming for real-time event broadcasting
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DomainEvent } from '@thematrix/types';
import { Logger } from '@thematrix/utils';

export class SSEManager {
  private readonly logger = new Logger({ prefix: 'SSEManager' });
  private readonly connections = new Set<ServerResponse>();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private readonly heartbeatMs: number;

  constructor(heartbeatMs = 30_000) {
    this.heartbeatMs = heartbeatMs;
  }

  /**
   * Handle an SSE connection on GET /api/events/stream.
   * Query params can filter event types: ?types=agent.started,workflow.completed
   */
  handleConnection(req: IncomingMessage, res: ServerResponse): void {
    // Parse subscribed types from query params
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const typesParam = url.searchParams.get('types');
    const subscribedTypes = typesParam ? new Set(typesParam.split(',').map((t) => t.trim())) : null;

    // Store subscription filter on the response object
    (res as SSEResponse).__sseTypes = subscribedTypes;

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Send initial comment to establish connection
    res.write(':connected\n\n');

    this.addConnection(res);

    req.on('close', () => {
      this.removeConnection(res);
    });

    req.on('error', () => {
      this.removeConnection(res);
    });
  }

  /** Add a connection and start heartbeat if needed */
  addConnection(res: ServerResponse): void {
    this.connections.add(res);
    this.logger.debug(`SSE client connected (total: ${this.connections.size})`);
    this.ensureHeartbeat();
  }

  /** Remove a connection and stop heartbeat if no clients remain */
  removeConnection(res: ServerResponse): void {
    this.connections.delete(res);
    this.logger.debug(`SSE client disconnected (total: ${this.connections.size})`);
    if (this.connections.size === 0) {
      this.stopHeartbeat();
    }
  }

  /** Broadcast a DomainEvent to all connected SSE clients */
  broadcast(event: DomainEvent): void {
    if (this.connections.size === 0) return;

    const data = JSON.stringify(event);
    let sent = 0;

    for (const res of this.connections) {
      const sseRes = res as SSEResponse;
      // If client subscribed to specific types, filter
      if (sseRes.__sseTypes && !sseRes.__sseTypes.has(event.type)) {
        continue;
      }

      try {
        res.write(`event: ${event.type}\n`);
        res.write(`id: ${event.eventId}\n`);
        res.write(`data: ${data}\n\n`);
        sent++;
      } catch {
        // Connection broken, remove it
        this.removeConnection(res);
      }
    }

    if (sent > 0) {
      this.logger.debug(`Broadcast event ${event.type} to ${sent} clients`);
    }
  }

  /** Get number of active connections */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /** Start the heartbeat interval */
  private ensureHeartbeat(): void {
    if (this.heartbeatInterval) return;
    this.heartbeatInterval = setInterval(() => {
      for (const res of this.connections) {
        try {
          res.write(':heartbeat\n\n');
        } catch {
          this.removeConnection(res);
        }
      }
    }, this.heartbeatMs);
  }

  /** Stop the heartbeat interval */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /** Close all connections and stop heartbeat */
  shutdown(): void {
    this.stopHeartbeat();
    for (const res of this.connections) {
      try {
        res.end();
      } catch {
        // Ignore errors during shutdown
      }
    }
    this.connections.clear();
  }
}

/** Internal type augmentation for SSE response filtering */
interface SSEResponse extends ServerResponse {
  __sseTypes: Set<string> | null;
}
