# Mystery Stock Market

A competitive market-deduction game for a classroom. Seven fictional stocks move
according to seven hidden mathematical rules. Participants join from their phones
with a single link, trade across a configured number of timed rounds, buy
intelligence, hide their tracks with secrets, and try to work out the mechanics
before anybody else does.

Inspired by Mystery Stock Market from *The Devil's Plan*, Season 3. Every figure
in the game is fictional and denominated in won.

---

## What it is

- **A real multiplayer application**, not a demonstration. An authoritative
  server decides when rounds close and what every price becomes; participants
  trade against a PostgreSQL-backed ledger.
- **A small, fully tested rule engine.** Seven closed mathematical templates,
  not a programming language. Their numbers and stock references are
  configurable; their structure is fixed and regression-tested.
- **Mobile-first.** A participant can buy or sell in two taps.
- **Classroom-ready.** A read-only projector board, a per-participant audit
  trail, and CSV exports of everything that happened.
- **It works without AI.** The optional administrator assistant can explain and
  calculate, but no price, rule, settlement, portfolio value or ranking ever
  comes from a model.

---

## Quick start

```bash
git clone <this repository> && cd mystery-stock-market
npm install
```

```bash
cp .env.example .env
```

Fill in `.env` — at minimum `DATABASE_URL`, `AUTH_SECRET`, `OWNER_EMAIL` and
`OWNER_PASSWORD`. Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Create the schema and the owner account:

```bash
npm run db:migrate
```

Run it:

```bash
npm run dev
```

Open <http://localhost:3000/admin>, sign in with the owner credentials, press
**New session**, choose **Quick start**, press **TEST MY GAME**, then **Open
registration** and **Start the game**. Participants go to `/join` with the code.

To create a fully configured demonstration session in one command:

```bash
npm run seed:demo
```

---

## The seven rules at a glance

| # | Default stock | Mechanic | Depends on |
|---|---|---|---|
| 1 | Defense Steel | Holdings-based price movement | The **change** in total market-wide holdings |
| 2 | Airtight Construction | Cross-stock price direction | Whether another stock **rose** last round |
| 3 | Latter Electronics | Holdings sweet spot | **Current** total holdings against a band |
| 4 | CoyoTech | Relative buying volume | **Gross purchases** versus another stock |
| 5 | Open Security | Secret-dependent movement | Whether a secret covers another stock |
| 6 | Seasonal Financial | Market-wide sentiment | How many stocks rose or fell |
| 7 | Alt Entertainment | Fixed scripted price path | Nothing — written in advance |

Rules 1, 3 and 4 use three *different* market variables that are deliberately
never conflated. See [docs/MARKET_ENGINE.md](docs/MARKET_ENGINE.md).

Full formulas with worked examples:
[docs/SEVEN_RULE_TEMPLATES.md](docs/SEVEN_RULE_TEMPLATES.md).

---

## Tests

```bash
npm test               # the engine: unit, integration and property-based
npm run test:smoke     # the whole game loop through the HTTP API
npm run test:acceptance# the §23 demonstration in real browsers
npm run typecheck
```

The smoke and acceptance runs need a server and database running:

```bash
npm run build && npm start   # in one terminal
npm run test:smoke           # in another
```

What each suite covers is described in
[docs/RULE_TESTING.md](docs/RULE_TESTING.md).

---

## Documentation

| Document | What it covers |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the pieces fit together and why |
| [GAME_HANDBOOK.md](docs/GAME_HANDBOOK.md) | The rules of the game itself |
| [ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md) | Running a session, start to finish |
| [PARTICIPANT_GUIDE.md](docs/PARTICIPANT_GUIDE.md) | A one-page guide for players |
| [SEVEN_RULE_TEMPLATES.md](docs/SEVEN_RULE_TEMPLATES.md) | Every formula, with worked examples |
| [RULE_TESTING.md](docs/RULE_TESTING.md) | The test suite and TEST MY GAME |
| [MARKET_ENGINE.md](docs/MARKET_ENGINE.md) | Settlement, market variables, exact arithmetic |
| [SECRET_MECHANIC.md](docs/SECRET_MECHANIC.md) | Secret timing and concealment |
| [INTELLIGENCE.md](docs/INTELLIGENCE.md) | Intelligence, Pieces and disclosures |
| [SECURITY.md](docs/SECURITY.md) | The security model |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Putting it online |

---

## Technology

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS · Recharts ·
PostgreSQL 16 via `pg` · Server-sent events for realtime · Vitest and
fast-check for tests · Playwright for the acceptance run.

The market engine under `src/engine` imports nothing from React, Next.js or the
database. It is a pure function library, which is why it can be tested
exhaustively and reused unchanged by the simulator, the readiness check and the
live settlement path.

---

## Licence and attribution

Written as a complete working implementation of the Mystery Stock Market brief.
The game concept is inspired by *The Devil's Plan*; this codebase is an
independent implementation and ships no third-party assets.
