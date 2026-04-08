'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { createEventStream } from './api-client';

interface UseEventStreamOptions {
  /** Whether to connect immediately (default: true) */
  enabled?: boolean;
  /** Callback for each event received */
  onEvent?: (event: { type: string; data: unknown }) => void;
}

/**
 * React hook for real-time SSE event streaming from the monitor server.
 * Provides connection status and auto-reconnection.
 */
export function useEventStream(options: UseEventStreamOptions = {}) {
  const { enabled = true, onEvent } = options;
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<{ type: string; data: unknown } | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const onEventRef = useRef(onEvent);

  // Keep callback ref in sync
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = createEventStream({
      onEvent: (event) => {
        setLastEvent(event);
        onEventRef.current?.(event);
      },
      onOpen: () => setConnected(true),
      onError: () => setConnected(false),
    });

    eventSourceRef.current = es;
  }, []);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [enabled, connect, disconnect]);

  return { connected, lastEvent, connect, disconnect };
}
