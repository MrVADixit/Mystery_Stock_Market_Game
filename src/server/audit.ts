/** Append-only audit trail. */

import type { PoolClient } from 'pg';
import { query } from './db';

export type ActorType = 'participant' | 'admin' | 'system' | 'display';

export interface AuditInput {
  gameId?: string | null;
  participantId?: string | null;
  userId?: string | null;
  actorType: ActorType;
  eventType: string;
  round?: number | null;
  payload?: Record<string, unknown>;
  ipHash?: string | null;
}

const SQL = `INSERT INTO audit_events
  (game_id, participant_id, user_id, actor_type, event_type, round, payload, ip_hash)
  VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`;

function args(e: AuditInput): unknown[] {
  return [
    e.gameId ?? null,
    e.participantId ?? null,
    e.userId ?? null,
    e.actorType,
    e.eventType,
    e.round ?? null,
    JSON.stringify(e.payload ?? {}),
    e.ipHash ?? null,
  ];
}

export async function recordAudit(e: AuditInput): Promise<void> {
  try {
    await query(SQL, args(e));
  } catch (err) {
    // Never let an audit write break a participant's trade.
    console.error('[audit] write failed', e.eventType, err);
  }
}

/** Inside an existing transaction, so the audit commits with the change. */
export async function recordAuditIn(client: PoolClient, e: AuditInput): Promise<void> {
  await client.query(SQL, args(e) as never[]);
}
