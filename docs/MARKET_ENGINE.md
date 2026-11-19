# The market engine

Everything the game knows about market mechanics lives under
[`src/engine`](../src/engine). That directory imports nothing from React,
Next.js or the database — it is a pure function library. The live settlement
path, the administrator's simulator, the readiness check and the test suite all
call the same functions, so what is previewed is what the game will do.

---

## Exact arithmetic

Every monetary amount is a whole number of won held as a JavaScript safe
integer. No floating point value is ever persisted or treated as authoritative.

Percentages are stored as integer **basis points** (1 bp = 0.01%). "13%" is the
exact integer `1300`, never the inexact binary double `0.13`.

```ts
pctDelta(base, bps)  // the exact won movement for bps applied to base
```

Rounding is **half away from zero**, applied once, to the final figure:

```
pctDelta(10_000, 1300)  →  1300
pctDelta(10_001, 1300)  →  1300     (1300.13)
pctDelta(10_050, -1000) →  -1005    (exact)
pctDelta(5, 1000)       →  1        (0.5 rounds away from zero)
```

In the database every money column is `BIGINT`, and `node-postgres` is
configured to parse `int8` into a number once, with a guard that throws rather
than silently losing precision if a value ever leaves the safe-integer range.

The price floor is enforced after every settlement, in every configuration,
without exception. An optional ceiling and an optional per-round movement cap
exist but are both off by default, so the classic preset's mechanics are
untouched.

---

## The five market variables

Specification §8.1 insists these stay distinct, and they are five separate
fields on the snapshot that are never derived from one another:

| Variable | Meaning | Used by |
|---|---|---|
| **Gross buying volume** | Shares bought during the round | Rule 4 |
| **Gross selling volume** | Shares sold during the round | (reported, not priced) |
| Net trading volume | buys − sells | nothing; shown for information |
| **Total current holdings** | Shares held by everyone right now | Rule 3 |
| **Change in total holdings** | `H(t) − H(t−1)` | Rule 1 |

Each comes from its own source at settlement time: current holdings from the
`holdings` table, the previous round's holdings from `round_stock_activity`, and
gross buying and selling separately from the immutable transaction ledger.

A round in which thirty shares were bought and thirty sold has gross buys of 30,
gross sells of 30, net volume of 0, unchanged total holdings, and a holdings
change of 0 — and the three rules that consult these figures all behave
differently as a result. That is the point.

---

## The round lifecycle

```
1.  Round opens, countdown begins
2.  Participants trade; secrets and intelligence remain available
3.  Round ends — the SERVER decides this, never a device
4.  Trading closes
5.  Market statistics are frozen into a snapshot
6.  All seven templates are evaluated against that one snapshot
7.  New prices are computed simultaneously
8.  Portfolio values and the leaderboard are recorded for the closed round
9.  The public information board updates
10. The next round opens
11. Any disclosure scheduled for that round becomes public
```

The completed round's data is the input to the following settlement. That is
what makes evaluation deterministic and prevents same-round feedback loops: a
trade placed in round 7 can only influence the price that round 8 trades at.

### The final round is never settled

A game of 24 rounds settles rounds 1 through 23. There is no round 25 for the
last settlement to produce prices for, and §21's final step is valuation, not
another price movement. Final assets are the cash plus the holdings valued at
round 24's prices.

This is why a scripted price path needs exactly `rounds` prices and not
`rounds + 1`.

---

## Simultaneity

All seven rules read the **same frozen snapshot**. No rule can see another
rule's output, so the seven prices are genuinely computed at once and the result
cannot depend on the order the stocks happen to be stored in. There is a test
for exactly that: settling a reversed stock list produces an identical price map.

A worked case: Defense Steel rose during the completed round but is about to
collapse to the floor because holdings surged. Airtight Construction follows
Defense Steel's direction. It reads the price Defense Steel *traded at during
the completed round*, so it takes the positive branch — not the new, collapsed
price being computed in the same pass.

---

## Replayability

Each settlement stores the exact snapshot it was computed from in
`market_snapshots`. Replaying that row through `settleRound` reproduces the same
prices, byte for byte. The administrator can view the frozen snapshot for any
round in **Market activity → Show the frozen market snapshot**.

A property test asserts this directly: for any reachable market state, settling
the same snapshot twice produces identical prices, identical branches and
identical explanations, and settlement never mutates the snapshot it was given.

---

## A round cannot settle twice

Settlement is driven lazily. Any read of the game state calls `advanceIfDue`,
which:

1. takes a row lock on the game (`SELECT … FOR UPDATE`),
2. checks the current round's stored `ends_at` against the database clock,
3. and, if the round is over, closes and settles it inside one transaction.

Because the whole sequence runs under that lock and additionally checks
`rounds.status`, concurrent callers cannot double-settle however many race. Each
open event stream also nudges the same function every two seconds, so a game
with nobody actively looking at it still advances.

The administrator's **End this round now** simply sets `ends_at` to the present
and lets the normal path run; there is no separate settlement code to keep in
sync.

---

## Trading

Orders go through `applyOrder` in [`src/engine/orders.ts`](../src/engine/orders.ts),
which both the live endpoint and the simulator use, so a simulated market obeys
exactly the same cash and holdings rules a real participant does.

Short selling and buying on credit are impossible **by construction**: there is
no code path that produces a negative cash or share balance. A rejected order
returns the position byte-for-byte unchanged, which is also a property test.

On the server each order executes inside a transaction that locks the
participant's row, so two simultaneous requests cannot both pass the cash check.
The client supplies an idempotency key, stored under a unique index; a retried
submission returns the original receipt instead of trading twice.

`MAX BUY` and `ALL` are resolved **on the server** against the real balance, not
from a number the device calculated.

---

## Reading the code

| File | What it holds |
|---|---|
| `money.ts` | Exact integer arithmetic and basis points |
| `types.ts` | Configuration and snapshot shapes |
| `templates.ts` | The seven rules |
| `settle.ts` | Simultaneous settlement, floor and cap |
| `orders.ts` | Order validation and application |
| `secrets.ts` | Secret windows and timing |
| `disclosure.ts` | Progressive reveal generation |
| `preset.ts` | The CLASSIC configuration |
| `validate.ts` | Errors and soft warnings |
| `simulate.ts` | Whole-game scenario runner |
| `scenarios.ts` | The standard scenario pack |
| `preview.ts` | One-round what-if |
| `readiness.ts` | TEST MY GAME |
