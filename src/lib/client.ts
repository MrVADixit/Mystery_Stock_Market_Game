'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Fetch wrapper that turns a JSON error body into a thrown ApiError. */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let code: string | undefined;
    try {
      const body = (await response.json()) as { error?: string; code?: string };
      if (body.error) message = body.error;
      code = body.code;
    } catch {
      /* a non-JSON error body; keep the generic message */
    }
    throw new ApiError(message, response.status, code);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** A unique key so a retried submission is never executed twice. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `k-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Live game state.
 *
 * The state is always fetched from `url`, which applies the server's
 * redaction. The event stream only tells us that something changed; it
 * never carries market data. A slow poll runs alongside it so the screen
 * still updates if the stream drops.
 */
export function useLiveState<T>(
  url: string,
  eventsUrl: string | null,
  options: { pollMs?: number } = {},
) {
  const [state, setState] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await api<T>(url);
      setState(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the server.');
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Signal stream.
  useEffect(() => {
    if (!eventsUrl) return;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      source = new EventSource(eventsUrl);
      source.addEventListener('hello', () => setConnected(true));
      source.addEventListener('game', () => {
        void refresh();
      });
      source.onerror = () => {
        setConnected(false);
        source?.close();
        // Reconnect with a small delay; the poll covers the gap.
        retry = setTimeout(connect, 4000);
      };
    };
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      source?.close();
    };
  }, [eventsUrl, refresh]);

  // Polling fallback and clock catch-up.
  useEffect(() => {
    const interval = setInterval(() => void refresh(), options.pollMs ?? 10_000);
    return () => clearInterval(interval);
  }, [refresh, options.pollMs]);

  // Refresh as soon as the tab comes back, so a phone that was asleep is
  // never showing a stale round.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [refresh]);

  return { state, error, loading, connected, refresh, setState };
}

/**
 * A countdown driven by the server's own figures.
 *
 * The device clock only interpolates between refreshes; it is never
 * authoritative, and the displayed value resets whenever the server sends
 * a new reading.
 */
export function useCountdown(secondsRemaining: number | undefined, serverTime: string | undefined) {
  const [seconds, setSeconds] = useState(secondsRemaining ?? 0);

  useEffect(() => {
    setSeconds(secondsRemaining ?? 0);
  }, [secondsRemaining, serverTime]);

  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, []);

  return seconds;
}
