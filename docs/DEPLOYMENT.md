# Deployment

The application is a standard Next.js server plus a PostgreSQL database. Nothing
else is required: no queue, no cache, no scheduler, no realtime service.

---

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `AUTH_SECRET` | yes | Signs and salts session material; 24+ characters |
| `OWNER_EMAIL` | first run | Creates the owner account on migration |
| `OWNER_PASSWORD` | first run | That account's password |
| `ANTHROPIC_API_KEY` | no | Enables the optional admin assistant |
| `APP_URL` | no | Used by `seed:demo` when printing links |
| `PGPOOL_MAX` | no | Connection pool size, default 10 |

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Append `?sslmode=require` to `DATABASE_URL` for a managed database; the pool
turns on certificate verification when it sees that.

---

## Vercel + a managed Postgres

The combination the project is built for.

1. Push the repository to GitHub and import it into Vercel.
2. Create a Postgres database (Vercel Postgres, Neon and Supabase all work —
   anything that speaks Postgres 14 or later).
3. Set the environment variables above in the Vercel project.
4. Run the migration once against the production database:

```bash
DATABASE_URL="postgres://…" OWNER_EMAIL="you@example.com" OWNER_PASSWORD="…" npm run db:migrate
```

5. Deploy.

### Things worth knowing on serverless

**Settlement needs no scheduler.** Rounds advance lazily: every read of the game
state checks whether the current round has expired and settles it under a row
lock if so. Each open event stream also nudges the same function every two
seconds. As long as one participant, one administrator or the display board has
the page open — which, during a lesson, is always true — the clock advances.

**Event streams and function duration.** `GET /api/events/[gameId]` is a
long-lived SSE connection. On Vercel this is a Node.js function; raise
`maxDuration` on your plan if streams are cut short. The client reconnects
automatically after four seconds and polls as a fallback, so a capped duration
degrades the responsiveness slightly and breaks nothing.

**Connection limits.** One hundred participants polling every eight seconds is
roughly thirteen requests a second. Use your provider's pooled connection string
(`-pooler` on Neon, port 6543 on Supabase) and keep `PGPOOL_MAX` modest — 5 to 10
per instance.

---

## A single server

A classroom machine, a small VPS or a container.

```bash
npm ci
npm run db:migrate
npm run build
npm start                 # listens on 3000
```

Put it behind a reverse proxy that terminates TLS and, importantly, **does not
buffer server-sent events**:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;          # required for the event stream
    proxy_read_timeout 1h;
}
```

The application already sends `X-Accel-Buffering: no` on the stream, which nginx
honours.

Keep it running with systemd, pm2 or a container restart policy.

---

## Docker

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/db ./db
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src ./src
EXPOSE 3000
CMD ["npm", "start"]
```

Run the migration as a one-off before the first start.

---

## Database maintenance

```bash
npm run db:migrate     # apply any new migrations; safe to re-run
npm run db:reset       # drop and recreate the schema (development only)
npm run seed:demo      # create a ready-to-run demonstration session
```

Migrations are applied once, in filename order, and their checksums are
recorded. Editing a migration that has already run is refused — add a new file
instead.

`db:reset` refuses to run with `NODE_ENV=production` unless `ALLOW_DB_RESET=yes`
is set.

### Housekeeping

Two functions are worth calling from a periodic job, though nothing breaks
without them:

- `pruneAuthSessions()` — removes expired sessions.
- `pruneRateLimits()` — removes stale rate-limit buckets.

### If you forget the administrator password

The `OWNER_EMAIL` and `OWNER_PASSWORD` variables are the source of truth for
that account. Changing `OWNER_PASSWORD` where the application is hosted and
redeploying resets it on the next start — the migration brings the stored
password back into line with the variable.

On Render: **Environment** → edit `OWNER_PASSWORD` → **Save**, which triggers a
redeploy. The build log will say:

```
owner password for you@example.com reset to match OWNER_PASSWORD
```

Leaving the variable unchanged does nothing, so this costs nothing on an
ordinary deployment.

### Backups

The data worth protecting is the ledger: `transactions`, `audit_events`,
`secret_activations` and `market_snapshots`. A nightly logical dump is more than
enough for classroom use.

---

## Scaling

The design target is **100 concurrent participants**, which a single small
instance handles comfortably: settlement is a pure function over a snapshot of
seven stocks, and the per-round write volume is tiny.

Several instances work without changes — realtime fan-out goes through Postgres
`LISTEN`/`NOTIFY` and rate limits live in the database, so no state is held in
a single process. Settlement is protected by a row lock, so concurrent
instances cannot double-settle a round.

The first thing to watch under real load is database connections, not CPU.

---

## Verifying a deployment

The quickest check needs no password at all:

```bash
BASE_URL=https://your-deployment npm run test:live
```

It confirms the site is served, that the database is connected and migrated
(a wrong-password login returning 401 rather than 500 proves the query ran),
that the security headers are set, and that unauthenticated callers are
refused.

To also exercise registering, trading, intelligence and secrets, create a
throwaway session in the browser, open registration, and pass its join code:

```bash
BASE_URL=https://your-deployment JOIN_CODE=ABC123 npm run test:live
```

It registers two participants called "ZZ Live Check", so use a session you are
happy to discard rather than the one your class will play.

If you have the administrator password to hand, the fuller suite creates and
plays a whole session by itself:

```bash
BASE_URL=https://your-deployment npm run test:smoke
```

105 checks covering the whole game loop. It leaves its sessions in the
database; archive them from the administrator screen afterwards if you care.

> Behind an HTTPS proxy, Node's `fetch` ignores `HTTPS_PROXY` unless you run
> with `NODE_USE_ENV_PROXY=1`. Without it you get a DNS error rather than a
> proxy error, which is misleading.

For the full browser demonstration:

```bash
BASE_URL=https://your-deployment npm run test:acceptance
```

---

## Upgrading

```bash
git pull
npm ci
npm run db:migrate
npm run build
```

Migrations are additive and idempotent. Check `docs/` for any note about a
configuration change between versions.
