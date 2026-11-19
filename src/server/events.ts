/**
 * Realtime notification bus.
 *
 * Events carry a signal only — the game id, an event name and a round
 * number. They never carry market data. Clients react by refetching
 * through the normal endpoint, which runs the redaction in state.ts, so
 * there is no path by which a realtime message could leak a concealed
 * price, a private holding or the identity of whoever imposed a secret.
 *
 * Fan-out goes through Postgres LISTEN/NOTIFY, so every server instance
 * sees every event, not just the one that handled the request.
 */

import { EventEmitter } from 'node:events';
import type { Client } from 'pg';
import { Client as PgClient } from 'pg';
import { query } from './db';

const CHANNEL = 'msm_events';

export type GameEventType =
  | 'round.opened'
  | 'round.settled'
  | 'trade'
  | 'secret'
  | 'intel'
  | 'disclosure'
  | 'participant.joined'
  | 'announcement'
  | 'game.status'
  | 'tick';

export interface GameEvent {
  gameId: string;
  type: GameEventType;
  round?: number;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

let listener: Client | null = null;
let listenerStarting: Promise<void> | null = null;

async function ensureListener(): Promise<void> {
  if (listener) return;
  if (listenerStarting) return listenerStarting;

  listenerStarting = (async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) return;
    const client = new PgClient({ connectionString });
    client.on('error', (err) => {
      console.error('[events] listener error, will reconnect', err.message);
      listener = null;
      listenerStarting = null;
    });
    client.on('end', () => {
      listener = null;
      listenerStarting = null;
    });
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    client.on('notification', (msg) => {
      if (!msg.payload) return;
      try {
        const event = JSON.parse(msg.payload) as GameEvent;
        emitter.emit(event.gameId, event);
      } catch {
        /* ignore an unparseable payload */
      }
    });
    listener = client;
  })();

  try {
    await listenerStarting;
  } finally {
    listenerStarting = null;
  }
}

/** Publishes an event to every instance. Never throws into the caller. */
export async function publish(event: GameEvent): Promise<void> {
  try {
    await query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify(event)]);
  } catch (e) {
    // If NOTIFY is unavailable, at least tell this instance's own clients.
    console.error('[events] publish failed', e);
    emitter.emit(event.gameId, event);
  }
}

/** Subscribes to one game's events. Returns an unsubscribe function. */
export async function subscribe(
  gameId: string,
  handler: (event: GameEvent) => void,
): Promise<() => void> {
  await ensureListener();
  emitter.on(gameId, handler);
  return () => emitter.off(gameId, handler);
}
