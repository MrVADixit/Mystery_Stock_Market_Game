# Rule testing

The rule library is a closed set of seven known mathematical structures. Their
numbers and stock mappings are configurable, but the formulas themselves are
fixed — which means they can be proven once and kept proven.

Nobody is expected to test permutations by hand.

---

## Running the tests

```bash
npm test                 # the engine suite (unit, integration, property-based)
npm run test:engine      # the same, scoped to src/engine
npm run test:watch       # watch mode
npm run typecheck
```

With a server and database running:

```bash
npm run test:smoke       # the whole game loop through the HTTP API
npm run test:acceptance  # the §23 demonstration in real browsers
npm run test:all         # all three in order
```

Current state: **171 engine tests**, **83 API checks**, **63 browser checks**.

---

## Layer 1 — per-template regression tests

`src/engine/templates.test.ts`. Every template is exercised across its branches
and boundaries with figures worked out by hand, so any change that alters a
rule's arithmetic fails immediately.

**Holdings-based movement** — holdings increase, decrease, no change; the
worked example that reaches the price floor; the worked example that recovers
from the floor; the boundary where the move lands exactly on the floor; the
optional per-round cap; an inverted relationship; and a case proving the rule
ignores gross volume entirely.

**Cross-stock direction** — reference rises, falls, is unchanged; the unchanged
branch made positive; the percentage taken from the target's own opening price;
half-away-from-zero rounding on an odd price; administrator-changed percentages;
and that the comparison is against the previous completed round.

**Holdings sweet spot** — one below the lower boundary, exactly the lower
boundary, inside, exactly the upper boundary, one above; inclusivity at both
ends; that it reads current holdings rather than the change; and a widened band
with new amounts.

**Relative buying volume** — target bought more, bought less, an exact tie, zero
activity on both; a case where net volume and gross volume point at *different*
branches, proving gross is used; repeated buy/sell cycles within one round; and
a tie configured as the positive branch.

**Secret-dependent movement** — secret active, inactive, a secret on an
unrelated stock, that the state read is the one for the upcoming round, and
administrator-changed values.

**Market sentiment** — four rising, four falling, three rising, three falling, a
mixed market; an exhaustive proof that the default 4/4 thresholds cannot both
fire across any seven-stock state; that an overlapping configuration throws
rather than guessing; and a custom universe with 5/5 thresholds.

**Scripted path** — the scheduled price at each round; that heavy holdings,
volume and secrets change nothing; floor enforcement on a scheduled price below
the floor; a missing price raising a clear error; a custom round count; and that
each round has exactly one authoritative price.

**Simultaneity** — all rules read one frozen snapshot; settlement does not depend
on stock ordering; the same snapshot settles identically twice.

---

## Layer 2 — integration scenarios

`src/engine/scenarios.test.ts` runs all seven rules together against the default
session across the fifteen required scenarios:

| # | Scenario | What it establishes |
|---|---|---|
| 1 | Nobody trades | Idle drift; the holdings rule stays still; cash is untouched |
| 2 | Steady buying | Accumulation pushes the holdings stock down |
| 3 | Steady selling | Unwinding pushes it up |
| 4 | Equal buying and selling | High gross volume with unchanged holdings |
| 5 | Holdings accumulate | Reaches the floor |
| 6 | Holdings unwound | Recovers from the floor |
| 7 | Secret imposed | Activation, duration and expiry boundaries |
| 8 | Inside the sweet spot | The positive branch holds while parked |
| 9 | One past the boundary | The negative branch at exactly upper + 1 |
| 10 | Four or more rise | The sentiment rule's positive branch |
| 11 | Four or more fall | Its negative branch |
| 12 | Mixed market | Its neutral branch, with other rules still firing |
| 13 | Full game | Every configured round with realistic trading |
| 14 | Market reaches the floor | The floor holds everywhere |
| 15 | Buying-volume duel | Only gross purchases decide the outcome |

Plus a deliberately extreme configuration (2,000 won per share, ±90%
percentages, ±9,000 won fixed moves) run through all fifteen scenarios to
confirm no invariant breaks under any of them, and a check that the optional
per-round movement cap is honoured when it is switched on.

---

## Layer 3 — property-based tests

`src/engine/properties.test.ts`, using fast-check with a fixed seed
(`20260419`, 200 runs) so every failure is reproducible. These assert the
invariants rather than enumerating values:

- Stock prices never fall below the configured floor — for any reachable market
  state, and for a custom floor.
- Price calculations are deterministic: the same frozen snapshot always produces
  the same settlement.
- Every settled price is a whole number of won.
- Settlement never mutates the snapshot it was given.
- No participant can spend more cash than they have: over any sequence of up to
  60 arbitrary orders, cash and share balances stay non-negative.
- A rejected order leaves the position byte-for-byte unchanged.
- Total holdings equal the sum of participant holdings, and the change in
  holdings always equals gross buys minus gross sells.
- A scripted stock produces the same price no matter what the market did.
- A secret covers exactly `duration` rounds starting the round after activation,
  for any activation round and duration.
- Simultaneous activations never lengthen a window.
- Percentage rules scale with the opening price, to within one won of rounding.

---

## TEST MY GAME

The administrator's readiness check (`src/engine/readiness.ts`) runs three
layers every time it is pressed.

**1. Configuration validation.** Errors block; warnings never do.

**2. Per-rule probes.** Every assigned rule is exercised against its own
configured numbers, with the expected figure computed *independently* of the
template code rather than by calling the same function and comparing it with
itself. The scripted path is additionally checked round by round while being fed
heavy fake trading, to confirm it ignores it.

**3. A real simulation** of the session's own rules, stocks and settings across
the full scenario pack, including a complete play-through.

### Verdicts

| Verdict | Meaning |
|---|---|
| `READY` | Everything passed and there are no warnings |
| `READY WITH WARNINGS` | Everything passed; some settings are worth reading first |
| `NEEDS CORRECTION` | A configuration error, or a check that actually failed |

### The report

Tests passed and failed, every warning and invalid setting with a direct link to
the rule card concerned, the rounds where a stock will hit the price floor,
every movement of 50% or more, and the per-scenario outcomes.

A game is never reported ready merely because its configuration parses: the
final check is an actual simulation using the session's selected rules, stocks
and settings.

---

## What the API smoke test covers

`tests/smoke-api.ts` drives a real session end to end over HTTP: administrator
sign-in, session creation, editing numbers and a reference stock, the readiness
check, registration, four participants, trading, idempotency, overspending,
overselling, concurrent orders, MAX BUY, secrets, intelligence, redaction,
display-token enforcement, settlement transparency, running to the end, final
results, the audit trail and every export.

It asserts things the engine tests cannot: that a retried request does not trade
twice, that concurrent orders from one participant cannot overspend, that a
participant's payload contains no other participant's identifier, that the
display board cannot be reached without its token, and that an anonymous caller
is refused everywhere.

---

## What the acceptance test covers

`tests/acceptance.ts` performs the §23 demonstration in real browsers: one
administrator window, four concurrent phone-sized participant contexts and an
anonymous display board, against a running server and database.

It covers all thirty-two numbered steps, including charts rendering, the
full-screen landscape chart, a participant disconnecting and reconnecting, the
secret concealing a price in another participant's view, and a CSV actually
downloading. Screenshots are written to `/tmp/msm-shots` for inspection.

Nothing in it is simulated with static front-end data.

---

## Adding a test

Per-template tests belong in `templates.test.ts` next to the rule they cover.
New invariants belong in `properties.test.ts`. A new integration scenario goes
in `src/engine/scenarios.ts` — add it to `standardScenarios` and it is picked up
automatically by the readiness check, the administrator's simulation screen and
the integration suite.
