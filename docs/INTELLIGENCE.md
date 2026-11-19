# Intelligence, Pieces and disclosures

Three connected systems decide who knows what, and when.

---

## Progressive disclosure

Every rule is written as **four fragments** that get progressively more specific,
ending in the complete formula with its numbers. They become public at the four
configured disclosure rounds — 5, 10, 15 and 20 in the classic preset, with
round 20 being full disclosure.

The system drafts all four for every template, so the administrator never has to
write a technical description. For a holdings-based rule:

1. *This stock responds to the total number of shares held across the whole
   market, not to any one player's trades.*
2. *The direction depends on whether those total holdings went up or down
   compared with the previous round.*
3. *The price moves by a fixed number of won for every single share of change —
   the more the holdings move, the bigger the swing.*
4. The complete formula, with the configured rate.

For a sweet-spot rule:

1. *This stock responds to the total shares held across all participants.*
2. *There is a specific range of total holdings that this stock favours.*
3. *Inside that range the price rises by a fixed amount; outside it the price
   falls by a fixed amount.*
4. The actual boundaries and amounts.

The wording is fully editable on each rule card, fragments can be moved earlier
in the sequence, and **Rewrite these from the rule** regenerates them after a
change. Unrevealed fragments stay private; previously revealed ones remain
accessible for the rest of the game.

Generation lives in [`src/engine/disclosure.ts`](../src/engine/disclosure.ts).

---

## BUY RULE INTEL

A participant spends one Piece to privately view **the next unrevealed segment**
of one selected stock's rule.

They cannot choose an arbitrary hidden fragment. They receive the next one in
the predefined sequence, skipping anything already public — because something
everybody already knows is not worth selling.

```
Publicly revealed: fragments 0 and 1
Already bought:    fragment 2
Next on offer:     fragment 3
```

When nothing is left, the stock shows *"You already know everything about this
stock"* instead of a price.

### The participant's experience

A compact list: the stock, the next available fragment, the cost, and a **Buy
intel** button. Pressing it shows a spinner, then a success tick. The purchased
text appears in their private Rule Intelligence section marked **Yours only**,
and their Piece or cash balance updates immediately. There is no checkout.

All intelligence is read from the stored rule configuration, so it can never
contradict the real rule.

---

## The Piece economy

Participants start with one **Piece** by default. A Piece can be:

- spent on one intelligence purchase, or
- exchanged for cash at the configured rate (10,000 won by default).

That is the whole decision, and it is a real one: one early clue, or ten percent
more capital. The administrator can also allow extra Pieces to be bought for
cash.

Every movement is recorded in `piece_ledger` with a reason, so the audit shows
exactly where a participant's Pieces went.

---

## Three payment models

The administrator picks exactly one. V1 deliberately does not combine them.

**Pieces** (default) — one Piece per purchase, with the optional cash exchange.

**Cash** — a fixed price per purchase, 50,000 won by default. Pieces are not
used at all.

**Disabled** — no intelligence in this session. Rules are learned only from the
public disclosure schedule and from watching the market.

---

## Deadline

Purchases close at the end of the configured round, 20 by default — which in the
classic preset is also the round of full disclosure, so intelligence stops being
purchasable at exactly the moment it stops being useful.

The server enforces the deadline; it is not merely a hidden button.

---

## What the administrator can configure

| Setting | Default |
|---|---|
| Mode | Pieces |
| Starting Pieces | 1 |
| Cash cost of an extra Piece | Not purchasable |
| Piece-to-cash exchange | Allowed, 10,000 won |
| Cash price per purchase (cash mode) | 50,000 won |
| Purchase deadline | End of round 20 |
| Disclosure rounds | 5, 10, 15, 20 |
| Disclosure wording | Generated, fully editable |

---

## The preview

Each rule card's **Edit** view shows all four fragments with the round each one
becomes public, so the administrator can see exactly what participants will be
told at every disclosure event before the game starts.

---

## A note on balance

Intelligence is powerful early and worthless late. A Piece spent in round 2 on
the right stock can shape a whole game; the same Piece spent in round 18 buys a
fragment that becomes public two rounds later.

If a session feels like it is decided too early, the levers are: fewer starting
Pieces, an earlier purchase deadline, or a later first disclosure round. If it
feels like nobody ever works anything out, move the disclosure rounds earlier.
