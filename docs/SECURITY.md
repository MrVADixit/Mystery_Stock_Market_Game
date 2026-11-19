# Security

The threat model here is specific: a room full of motivated people with browser
developer tools open, who would very much like to see a concealed price, read a
hidden rule, trade after the bell, or spend money they do not have.

---

## Authentication

Two kinds of principal share one mechanism.

- **Administrators** are rows in `users` with a role of `owner` or `admin`.
- **Participants** are rows in `participants`, scoped to one game.

Both receive an opaque 256-bit random token in an `HttpOnly`, `SameSite=Lax`
cookie, `Secure` in production. **Only the SHA-256 hash of the token is stored**,
so a database leak cannot be replayed against a running game.

Passwords and participant passphrases are hashed with **scrypt** (N=2¹⁶, r=8,
p=1) from Node's standard library — memory-hard, no native dependency to keep
patched. Verification is constant-time. A sign-in attempt for an address that
does not exist still spends comparable time, so response timing does not reveal
whether an account exists.

### Signing in with a provider

Optional, for administrators only; participants are unaffected. The flow is a
standard OAuth 2.0 authorisation code exchange with PKCE on Google (GitHub's
OAuth Apps do not support it). The `state` value and the PKCE verifier travel
in a short-lived `HttpOnly` cookie and the returned state is compared in
constant time, so a sign-in cannot be forged from another site.

The authorisation decision is deliberately conservative and lives in one
testable function, `decideSignIn`:

1. An identity already linked to an account signs in to that account.
2. Otherwise the provider must report a **verified** email address.
3. That address may sign in to an account that already exists.
4. Only an address in `ADMIN_ALLOWED_EMAILS` may create a new account.

Without that fourth rule, anybody on the internet with a Google account could
sign in to the administrator screens of a public deployment, so it is off by
default. Refusals are recorded in the audit trail.

An administrator who only signs in with a provider has a null `password_hash`,
and the password path refuses such accounts outright rather than comparing
against an empty value.

### Authorisation

`requireGameAdmin` checks that the caller administers *that specific game*; the
owner account may administer any, an `admin` only their own. `requireParticipant`
checks that the caller is registered in the game they are addressing — holding a
valid session for game A grants nothing in game B.

---

## The redaction boundary

[`src/server/state.ts`](../src/server/state.ts) is the only place that decides
what each audience may see. Concealed data is **removed there, server-side**,
before it reaches a response body. It is never sent and then hidden in the UI.

The three audiences are explicit: `participant`, `display`, `admin`.

Realtime events carry **a signal only** — `{gameId, type, round}`. They never
carry market data. A client reacts by refetching through its own endpoint, which
runs the redaction again. There is therefore no path by which a realtime message
could leak a concealed price, a private holding or the identity of whoever
imposed a secret.

The API smoke test asserts this directly: a participant's payload contains no
other participant's identifier and no secret-creator field.

---

## Trading integrity

**Double spending.** Each order executes inside a transaction that takes a row
lock on the participant (`SELECT … FOR UPDATE`). Two simultaneous requests
serialise; they cannot both pass the cash check. A property test and a
concurrency check in the smoke test both cover this.

**Duplicate submissions.** The client sends an idempotency key, stored under a
unique index on `(participant_id, idempotency_key)`. A retry returns the original
receipt rather than trading twice. The UI additionally disables the buttons while
a request is in flight.

**Late trading.** The device countdown is never authoritative. The trading
endpoint re-reads the stored `rounds.ends_at` and compares it against the
*database's* clock, and refuses anything at or past it. Settlement runs before
the order is even considered, so an order cannot land in a round that has
already expired.

**Overspending and overselling.** Impossible by construction: `applyOrder` has no
code path that produces a negative cash or share balance, and the database
carries `CHECK (cash >= 0)` and `CHECK (quantity >= 0)` as a second line of
defence.

**Server-side resolution.** `MAX BUY` and `ALL` are resolved on the server
against the real balance, never from a figure the device computed.

---

## The display board

A separate, unguessable 256-bit token in the URL, verified in constant time
against the stored value.

The board:

- is read-only — it has no trading or administrative endpoint at all;
- shows exactly what the public is allowed to see, through the same redaction;
- never reveals an unrevealed rule fragment;
- respects active secrets;
- exposes no private participant trading history;
- is served with `X-Robots-Tag: noindex, nofollow, noarchive` and a `robots`
  meta tag.

The administrator can regenerate or revoke the token at any time. Revoking stops
an already-open page working on its next refresh.

---

## Rate limiting

A token bucket held in PostgreSQL, so limits apply across every server instance
rather than only the one that handled the request.

| Action | Limit |
|---|---|
| Administrator sign-in | 10 per 5 minutes per address |
| Join / reconnect | 20 per minute per address |
| Trade | 60 per 20 seconds per participant |
| Impose a secret | 10 per minute per participant |
| Buy intelligence | 20 per minute per participant |
| Exchange Pieces | 10 per minute per participant |
| Display board state | 120 per minute per address |
| AI assistant | 30 per 5 minutes per administrator |

Exceeded limits return `429` with a `Retry-After` header.

---

## Input validation

Every request body is parsed with a zod schema before it reaches a service.
Session configurations go through a full structural schema and then the engine's
own validator, which enforces the game-design rules (reference stocks that
exist, non-overlapping sentiment thresholds, scripted prices for every round,
ascending disclosure rounds).

Display names are restricted to letters, numbers, spaces, dots, apostrophes and
hyphens, 2–24 characters, unique per game.

CSV exports escape any value beginning with `=`, `+`, `-` or `@` so a
participant cannot inject a spreadsheet formula through their display name.

---

## The immutable ledger

`transactions`, `secret_activations` and `audit_events` carry a trigger that
raises on `UPDATE` or `DELETE`. Nothing in the application can rewrite history,
and past state is never reconstructed from current balances — every transaction
row stores cash and holdings before *and* after.

`audit_events` records registrations, reconnections, trades, secret activations,
intelligence purchases, administrator actions, settlements and exports, with a
salted hash of the client address rather than the address itself.

---

## Secrets management

No secret is ever committed. `.env` is git-ignored; `.env.example` documents the
variables. `AUTH_SECRET` must be at least 24 characters and the application
refuses to start the auth path without it.

The Anthropic API key, when present, is used **only** on the server. The AI
assistant cannot execute database commands or modify the market engine: it is
restricted to four read-only tools that call the same engine functions the
administrator can press, and the UI shows every call it made.

---

## HTTP headers

| Header | Value |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `same-origin` |
| `X-Robots-Tag` (on `/display/*`) | `noindex, nofollow, noarchive` |
| `Cache-Control` (on `/api/*`) | `no-store, max-age=0` |

`poweredByHeader` is disabled.

---

## Known limitations

**One shared participant cookie per browser.** A single browser profile can be
signed in to one game at a time as a participant. Two concurrent games need two
profiles or an incognito window. This is a deliberate simplification.

**No CSRF token.** Mutating endpoints are JSON-only `POST`/`PUT` requests with
`SameSite=Lax` cookies, which blocks cross-site form submission. If this is
deployed somewhere that needs defence in depth against a same-site subdomain
attacker, add an origin check in `src/server/http.ts`.

**Collusion is not prevented.** Several participants cooperating to move a
holdings-based stock is a legitimate strategy, not an attack. The audit trail
makes it visible to the administrator afterwards.

**Two advisory npm findings remain**, both for the PostCSS version bundled
inside Next.js and both build-time only (a CSS stringify issue with no reachable
path in this application). They resolve when Next ships an updated bundle.

---

## Reporting

If you find something, the places most worth looking are `src/server/state.ts`
(redaction), `src/server/trading.ts` (atomicity) and `src/server/auth.ts`
(session handling).
