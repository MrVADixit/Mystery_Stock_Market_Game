# Reporting a security issue

Please **do not** open a public issue for a security problem.

Use GitHub's private reporting instead — the **Security** tab of this
repository, then *Report a vulnerability*. That reaches the maintainer without
making the details public first.

Please include what you found, how to reproduce it, and what an attacker could
do with it. You will get a reply as quickly as reasonably possible.

## What counts

This game is usually run in a classroom, so the interesting attacks are the
ones a motivated participant could mount from a phone with developer tools
open:

- reading a price, holding or rule fragment they should not be able to see
- trading after the round has closed, or spending money they do not have
- identifying who imposed a secret
- reaching another participant's trading history
- reaching the administrator's controls

The security model, and the specific defences against each of those, is written
up in [docs/SECURITY.md](docs/SECURITY.md). The places most worth looking are
`src/server/state.ts` (redaction), `src/server/trading.ts` (atomicity) and
`src/server/auth.ts` (sessions).

## What does not count

- Participants cooperating to move a stock. That is a legitimate strategy and
  the audit trail makes it visible to the teacher afterwards.
- Anything requiring the administrator's password, which is chosen at
  deployment.
