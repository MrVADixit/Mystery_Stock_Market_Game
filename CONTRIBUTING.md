# Contributing

Thanks for taking a look. Issues and pull requests are both welcome.

## Running it locally

You need Node 22 and a PostgreSQL database.

```bash
npm install
cp .env.example .env     # then fill in DATABASE_URL and AUTH_SECRET
npm run db:migrate
npm run dev
```

`npm run seed:demo` creates a ready-to-play session and prints the links.

## Before you open a pull request

```bash
npm run typecheck
npm run lint
npm test
```

If you touched anything the server does, run the integration tests too. They
need the app running against a database:

```bash
npm run build && npm start      # one terminal
npm run test:smoke              # another
```

## The one rule that matters

**The seven pricing mechanics are a closed set.** They are not an expression
language, and that is deliberate — it is what makes the whole rule library
exhaustively testable. Numbers and stock references are configurable; the
mathematical structures are not.

If you want a new kind of market behaviour, the honest options are to add an
eighth template with its own tests, or to build a new game template out of the
existing seven. Please open an issue first so we can talk about which.

## Where things live

| Path | What it is |
|---|---|
| `src/engine/` | The market. Pure TypeScript, no framework, no database |
| `src/server/` | Services: auth, trading, rounds, secrets, redaction |
| `src/app/` | Routes and pages |
| `docs/` | How everything works, including the formulas |

`src/engine` imports nothing from React, Next.js or `pg`. Please keep it that
way — it is why the tests run in under two seconds.

## Style

TypeScript strict mode, no `any` without a reason, and comments that explain
*why* rather than restating the code. British or American spelling, whichever
you prefer; nobody is going to argue about it.
