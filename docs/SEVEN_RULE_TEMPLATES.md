# The seven rule templates

Every stock in Mystery Stock Market is priced by exactly one template. There are
seven of them, plus a trivial eighth (`UNCHANGED`) that never moves.

A template is a **closed mathematical structure**. The administrator can change
its numbers and which stocks it refers to; the structure itself cannot be
rewritten, and there is no formula language, no nested condition builder and no
user-written expression anywhere in the product. That restriction is what makes
the whole rule library testable: the formulas are already proven, so configuring
a game is choosing values, not writing code.

All of these live in [`src/engine/templates.ts`](../src/engine/templates.ts).

Throughout, prices are whole won. Percentages are stored as integer basis points
(1 bp = 0.01%), so "13%" is the exact integer 1300 and never the inexact binary
double 0.13. Rounding is **half away from zero**, applied once, to the final
figure.

---

## Rule 1 — Holdings-based price movement

**Default stock:** Defense Steel

> For every additional share in total market-wide holdings compared with the
> previous round, the price decreases by 200 won. For every share of decrease,
> the price increases by 200 won.

Let `H(t)` be the total shares held by **all** participants at the end of round
`t`.

```
change = H(t) − H(t−1)

change > 0  →  price − (200 × change)
change < 0  →  price + (200 × |change|)
change = 0  →  no movement
```

### Worked examples

| Opening price | H(t−1) | H(t) | change | Movement | New price |
|---|---|---|---|---|---|
| 10,000 | 0 | 5 | +5 | −1,000 | 9,000 |
| 10,000 | 13 | 10 | −3 | +600 | 10,600 |
| 10,000 | 17 | 17 | 0 | 0 | 10,000 |
| 10,000 | 0 | 50 | +50 | −10,000 | **100** (floor) |
| 100 | 50 | 0 | −50 | +10,000 | 10,100 |

The fourth row is the specification's own example: 10,000 − 10,000 = 0, which is
below the 100 won floor, so the floor applies.

### Editable

Target stock · price movement per share · the direction of the relationship ·
an optional cap on the holdings change counted in one round.

### What it does *not* use

Not gross buying, not gross selling, not net volume. Only the difference between
two end-of-round holdings totals. Thirty shares bought and thirty sold in the
same round leaves this rule completely still.

---

## Rule 2 — Cross-stock price direction

**Default stock:** Airtight Construction · **Reference:** Defense Steel

> If the reference stock's price increased during the previous completed round,
> this stock increases by 10%. Otherwise it decreases by 10%.

```
reference rose      →  price + 10% of this stock's opening price
reference fell      →  price − 10%
reference unchanged →  the negative branch (configurable)
```

"The previous completed round" means `P(t)` versus `P(t−1)` for the reference
stock: the movement that was visible *during* the round that just closed.

### Worked examples

Target opening price 10,000; reference moved 9,000 → 10,000 (it rose):

```
+10% of 10,000 = +1,000  →  11,000
```

Target opening price 7,355; reference rose:

```
10% of 7,355 = 735.5  →  rounds away from zero to 736  →  8,091
```

### Editable

Target stock · reference stock · the rise percentage · the fall percentage ·
whether an unchanged reference counts as the positive or negative branch
(default: negative).

The percentage is always taken from the **target** stock's own opening price.

---

## Rule 3 — Holdings sweet spot

**Default stock:** Latter Electronics

> If total holdings across all participants are between 10 and 30 shares
> inclusive, the price increases by 1,500 won. Otherwise it decreases by 1,000.

```
lower ≤ H(t) ≤ upper  →  price + 1,500
otherwise             →  price − 1,000
```

The range is **inclusive at both ends**. The rule editor shows these exact
boundary cases on the card:

| Total holdings | Branch | Movement |
|---|---|---|
| 9 | outside | −1,000 |
| **10** | inside | +1,500 |
| 20 | inside | +1,500 |
| **30** | inside | +1,500 |
| 31 | outside | −1,000 |

### Editable

Target stock · lower boundary · upper boundary · the inside amount · the
outside amount.

### What it uses

`H(t)` — the **current total holdings** at the end of the completed round. Not
the change in holdings (that is Rule 1), and not volume.

---

## Rule 4 — Relative buying volume

**Default stock:** CoyoTech · **Comparison:** Latter Electronics

> If more CoyoTech shares were purchased during the completed round than Latter
> Electronics shares, CoyoTech increases by 1,400 won. Otherwise it decreases by
> 700 won.

```
grossBuys(target) > grossBuys(comparison)  →  price + 1,400
otherwise (including a tie)                →  price − 700
```

### Worked examples

| Target bought | Comparison bought | Branch | Movement |
|---|---|---|---|
| 10 | 4 | won | +1,400 |
| 4 | 10 | lost | −700 |
| 7 | 7 | tie → negative | −700 |
| 0 | 0 | tie → negative | −700 |

**Gross, never net.** If the target was bought 10 and sold 10 while the
comparison was bought 4, the figures compared are 10 against 4 — the positive
branch — even though the target's net volume was zero. Repeated buy/sell cycles
inside one round therefore accumulate buying volume, which is a legitimate and
deliberate strategy.

### Editable

Target stock · comparison stock · the winning amount · the losing amount ·
whether an exact tie counts as positive or negative (default: negative).

---

## Rule 5 — Secret-dependent movement

**Default stock:** Open Security · **Watched stock:** Latter Electronics

> If a secret is active on the watched stock during the upcoming round, this
> stock increases by 13%. Otherwise it decreases by 1,000 won.

```
secret covers the watched stock in round t+1  →  price + 13%
otherwise                                      →  price − 1,000
```

This is the clearest case of one stock being driven by an *action taken on a
different stock*. Note the timing: the rule is evaluated against the secret
state that will apply to the **round the new price is for**, not the round that
just closed. A secret imposed during round 2 is active in rounds 3 and 4, so the
settlement at the end of round 2 (which prices round 3) already sees it.

### Editable

Target stock · the watched stock · the active percentage · the inactive amount.

If secrets are disabled for the session, this rule always takes its negative
branch, and the validator warns about exactly that.

---

## Rule 6 — Market-wide sentiment

**Default stock:** Seasonal Financial

> If four or more of the seven stocks recorded positive price changes during the
> previous completed round, this stock increases by 20%. If four or more
> recorded negative changes, it decreases by 10%. Otherwise it is unchanged.

```
rising  ≥ 4  →  price + 20%
falling ≥ 4  →  price − 10%
otherwise    →  unchanged
```

A stock counts as rising when `P(t) > P(t−1)` and falling when `P(t) < P(t−1)`.

### The overlap rule

Both branches can fire at once exactly when the two thresholds fit inside the
counted universe together:

```
risingThreshold + fallingThreshold ≤ universeSize   →  overlap possible
```

With the default seven stocks, 4 + 4 = 8 > 7, so four rising and four falling
can never happen simultaneously. The validator **rejects** any configuration
where the sum is less than or equal to the universe size and tells the
administrator to raise a threshold. The engine additionally throws rather than
silently picking a branch if such a configuration is ever forced through.

### Editable

Target stock · which stocks are counted · the rising threshold · the falling
threshold · the rally percentage · the sell-off percentage.

---

## Rule 7 — Fixed scripted price path

**Default stock:** Alt Entertainment

> This stock follows a predetermined price trajectory. Its price does not depend
> on buying volume, selling volume, aggregate holdings, other stock prices or
> any participant action.

```
price(round t+1) = schedule[t+1]      (then clamped to the floor)
```

The shipped 24-round schedule climbs, gives it all back, then climbs harder —
the rise-and-fall silhouette of the Mystery Stock Market logo:

```
R1  10,000   R7  14,100   R13 11,500   R19  9,200
R2  11,200   R8  12,400   R14 13,800   R20 10,700
R3  12,600   R9  10,900   R15 16,400   R21 12,900
R4  11,800   R10  9,300   R16 15,100   R22 15,600
R5  13,500   R11  8,100   R17 13,200   R23 18,200
R6  15,200   R12  9,600   R18 11,000   R24 21,000
```

The price-path editor shows every round, its scheduled price and the percentage
difference from the previous round, and each price can be edited directly. If
the number of rounds changes, the administrator can rescale the existing
trajectory proportionally (preserving its shape) or type a new schedule.

**There must be exactly one authoritative price for every configured round.** A
missing price is a blocking error, not a warning, and the readiness check
verifies each scheduled transition individually while deliberately feeding the
rule heavy fake trading to confirm it ignores it.

The configured price is still subject to the price floor.

### Editable

Target stock · every scheduled price.

---

## Unchanged

A stock can be assigned the `UNCHANGED` template, which never moves whatever
happens. It is useful as a control stock, or as a placeholder while a session is
being designed.

---

## Assigning templates to stocks

Stock names and rule templates are completely independent. The Defense Steel
mechanic can be moved to any other stock by picking a different target; the
cross-stock and comparison references are dropdowns. A template may be used by
several stocks at once — the rule editor's **Duplicate to…** button copies a
mechanic onto another stock and repoints any self-reference so the copy stays
legal.

Nothing about this requires rewriting mathematics.
