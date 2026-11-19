# Architecture

## The shape of the thing

```
┌──────────────────────────────────────────────────────────────┐
│  Browsers                                                    │
│  /play (phones)   /admin (teacher)   /display (projector)    │
└───────────┬───────────────┬──────────────────┬───────────────┘
            │ fetch + SSE   │                  │ token only
┌───────────▼───────────────▼──────────────────▼───────────────┐
│  Next.js route handlers  (src/app/api)                       │
│  auth · rate limiting · request validation (zod)             │
└───────────┬──────────────────────────────────────────────────┘
            │
┌───────────▼──────────────────────────────────────────────────┐
│  Services  (src/server)                                      │
│  games · rounds · trading · secrets · intel · state · results│
│  ── state.ts is the single redaction boundary ──             │
└───────────┬──────────────────────────────┬───────────────────┘
            │                              │
┌───────────▼───────────────┐  ┌───────────▼───────────────────┐
│  Engine  (src/engine)     │  │  PostgreSQL                   │
│  pure TypeScript,         │  │  immutable ledger,            │
│  no IO, no framework      │  │  frozen snapshots, audit      │
└───────────────────────────┘  └───────────────────────────────┘
```

Three rules hold this together:

1. **The engine knows nothing about IO.** It is a pure function library. The
   live game, the simulator, the readiness check and the tests all call the same
   functions.
2. **The server is authoritative.** No figure computed in a browser is ever
   treated as true — not a price, not a portfolio total, not the countdown.
3. **Redaction happens once, server-side.** `state.ts` is the only place that
   decides what each audience may see. Hidden data is removed before it reaches
   a response body or a realtime message.

---

## Layers

### `src/engine` — the market

Pure TypeScript with no dependencies on React, Next.js or `pg`. Described in
[MARKET_ENGINE.md](MARKET_ENGINE.md). Because it is pure, the 171-case test
suite can exercise it exhaustively in under a second, and the administrator's
preview runs the *same* code that will price the live game.

### `src/server` — the services

| Module | Responsibility |
|---|---|
| `db.ts` | Connection pool, transactions, integer parsing |
| `auth.ts` | Administrator and participant sessions, display tokens |
| `password.ts` | scrypt hashing |
| `config-store.ts` | SessionConfig ⇄ database rows |
| `games.ts` | Session lifecycle |
| `rounds.ts` | The authoritative clock and settlement |
| `trading.ts` | Atomic, idempotent orders |
| `secrets-service.ts` | Imposing secrets |
| `intel.ts` | Intelligence and Pieces |
| `state.ts` | **The redaction boundary** |
| `results.ts` | Final standings, audit, CSV export |
| `simulation.ts` | Administrator simulations (never touches a live session) |
| `events.ts` | Realtime fan-out |
| `ai.ts` | The optional assistant |
| `ratelimit.ts`, `audit.ts`, `http.ts`, `env.ts`, `ids.ts` | Supporting concerns |

### `src/app` — routes and UI

Route handlers under `api/`, pages elsewhere. Components live in
`src/components`, split into `play/` (participant), `admin/` and shared
primitives.

---

## Realtime

Server-sent events over a single `GET /api/events/[gameId]` stream.

The important design decision: **events carry a signal only** — a game id, an
event name and a round number. They never carry market data. A client reacts by
refetching through its own state endpoint, which runs the redaction. There is
therefore no path by which a realtime message could leak a concealed price, a
private holding or the identity of whoever imposed a secret.

Fan-out goes through PostgreSQL `LISTEN`/`NOTIFY`, so every server instance sees
every event rather than only the one that handled the request.

Each client also runs a slow poll as a fallback, refreshes when the tab becomes
visible again, and reconnects the stream with a delay if it drops. A phone that
was asleep in a pocket is never left showing a stale round.

### The countdown

The displayed countdown interpolates locally between refreshes but is reset by
every server reading, and the server alone decides when trading closes. A device
with a wrong clock, or one that was suspended, cannot trade late: the trading
endpoint validates against the stored `rounds.ends_at` using the database's own
clock.

---

## Data model

Entities are normalised where the shape is fixed and JSONB only where the shape
is genuinely template-specific:

- `users`, `auth_sessions` — identity
- `rule_templates` — the closed library, seeded by migration
- `games`, `game_configs`, `stocks`, `stock_rules` — one session's setup
- `participants`, `holdings` — who is playing and what they hold
- `rounds`, `stock_prices`, `market_snapshots`, `rule_evaluations`,
  `round_stock_activity`, `participant_round_values` — what happened each round
- `transactions` — the immutable ledger
- `secret_activations`, `intel_purchases`, `piece_ledger`,
  `disclosure_events`, `announcements` — the game's special mechanics
- `audit_events` — everything anyone did
- `rate_limits` — shared across instances

`stock_rules.params` is JSONB because each template takes different parameters,
but `template_id` is a real foreign key into the closed `rule_templates` set, so
a rule can never name a mechanic that does not exist.

### Immutability

`transactions`, `secret_activations` and `audit_events` carry a trigger that
raises on `UPDATE` or `DELETE`. Past history is never reconstructed from current
balances; every transaction row stores cash and holdings before *and* after, so
the audit trail stands on its own even after a game is archived.

---

## Why these choices

**Why not an unrestricted rule language?** It was the brief's central
instruction, and it is right. Seven closed templates can be regression-tested
exhaustively; an expression language cannot. The configuration space stays
large (every number, every stock reference, every threshold) while the
correctness surface stays small.

**Why server-sent events rather than WebSockets?** The traffic is one-directional
— the server tells clients something changed — and SSE reconnects by itself, works
through ordinary HTTP infrastructure, and needs no additional service. Since the
events carry no data, there is nothing a bidirectional channel would add.

**Why lazy settlement rather than a scheduler?** A background job is another
process to deploy and keep alive. Driving settlement from state reads plus the
open event streams means the clock advances whenever anyone is watching, and a
game with nobody watching has nothing to advance for. The row lock makes it safe
under any amount of concurrency, and the administrator can always force a round.

**Why integer won rather than decimals?** Exactness, with no dependency and no
conversion layer. Every price in this game is a whole number of won by design.
