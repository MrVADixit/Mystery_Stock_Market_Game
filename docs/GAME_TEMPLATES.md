# Game templates

Two different things in this project are called a template, so it is worth
separating them up front:

| Term | What it is | Where it lives |
|---|---|---|
| **Rule template** | One of the seven pricing mechanics | `src/engine/templates.ts` |
| **Game template** | A whole ready-to-play session | `src/engine/game-templates.ts` |

This document is about the second: a complete game — a set of companies, a
mapping of mechanics onto them, the numbers, the scripted price path and the
session settings — that an administrator can start a session from in one click.

Twelve are built in. Administrators can save their own.

---

## The design problem

A classroom plays the game. Three weeks later the same class plays again. If the
second session is recognisably the first one, the deduction — which is the entire
point — is already over before round 1.

Three layers deal with that.

### 1. No two built-in templates share anything recognisable

Every built-in template uses:

- **A different set of company names.** Eighty-four names across the library,
  with no repeats. There is a test asserting this.
- **A different arrangement of mechanics.** No two templates assign the seven
  mechanics to their companies in the same order, and the holdings rule appears
  in at least five different positions across the library.
- **Different numbers.** Rates, bands, thresholds, percentages and scripted
  paths are all distinct.
- **Sometimes a different shape.** Six, seven or eight companies; twelve, twenty,
  twenty-four or thirty rounds; different starting capital.

So knowing *Deep Harbour* tells a player nothing useful about *Permafrost*.

### 2. Scrambling

That still leaves one hole: a class that plays *Deep Harbour* twice. Scrambling
closes it. When a session is created — **on by default** — the engine:

- **re-assigns which company runs which mechanic**,
- **repoints every cross-reference** (the followed stock, the volume
  comparison, the watched stock),
- **varies every number** within bands that keep the game sound,
- **varies the opening prices**,
- **shuffles the order the companies are listed in**,
- and, about a third of the time, **reverses the holdings rule** so that buying
  pushes the price *up* instead of down.

That last one is the sharpest tool in the box. "Everyone piling in pushes it
down" is the first instinct anybody forms in this game, and a scrambled session
will sometimes punish it.

The measured result, over 500 seeds on the classic template:

> A company keeps the mechanic it had before scrambling **13.6%** of the time.
> Pure chance for seven companies is **14.3%**.

In other words, a returning player's memory of which company did what is worth
nothing. There is a test asserting this statistically, not just structurally.

### 3. Deterministic seeds

Scrambling is seeded, so it is reproducible. The seed is stored on the game and
shown to the administrator. Reuse it and you get byte-for-byte the same puzzle —
useful for running the identical game with two classes, or for reproducing a
session when something needs investigating. Leave it blank and every session is
a fresh puzzle.

---

## The twelve built-in templates

| Template | Theme | Shape | What makes it different |
|---|---|---|---|
| **Classic Mystery Stock Market** | The original seven | 7 × 24 | The reference implementation of all seven mechanics |
| **Orbital Freight** | Low-orbit logistics | 7 × 24 | The scripted stock sits first, where nobody looks |
| **Deep Harbour** | Ports and shipping | 7 × 24 | One company is both a cross-reference and a volume comparison, so moving it moves two others |
| **Greenfield** | Agriculture and food | 7 × 20 | Gentle: smaller movements, a wide sweet spot, nobody is wiped out early. A good first game |
| **Neon District** | Nightlife and retail | 7 × 24 | The most volatile. Expect a floor hit, and expect it to be deliberate |
| **Permafrost** | Arctic energy | 7 × 24 | Deliberately bearish. Holding cash is a real strategy |
| **Clockwork** | Precision manufacturing | 7 × 24 | A capped holdings rule: no single round can crash it, so manipulation has to be sustained |
| **Monsoon** | Tropical infrastructure | 7 × 24 | The holdings rule is **inverted** — buying pushes the price up |
| **Red Sand** | Desert extraction | 7 × 24 | Opening prices spread 7,000–14,000, so the same fixed-won rule behaves very differently stock by stock |
| **Paper Trail** | Finance and bureaucracy | 7 × 24 | Deceptive: the scripted stock barely moves and looks safe; the sentiment rule needs five risers and fires rarely but hard |
| **Tidal Reach** | Estuary energy | 6 × 12 | A single lesson. **One mechanic is absent entirely** — players hunt for something that is not there |
| **Cascade** | River systems | 8 × 30 | The densest. Two sweet spots on different bands, which the market cannot satisfy at once |

Each carries a designer's note in the picker explaining how it plays.

---

## Choosing one

**New session** opens a gallery. Each card shows the name, theme, size, length,
description, the first few company names and — expandable — which mechanic each
company runs. That last part is for the teacher; participants obviously never
see it.

Underneath: the game name, the round count and duration (pre-filled with what the
template was designed for), and the scramble toggle with an optional seed.

There is also **Build from scratch**, which creates the number of companies you
ask for, all on the unchanged-price mechanic, for you to assign yourself.

---

## Editing

A template is a starting point, not a cage.

Once a session exists and before it starts, everything is editable:

- **Stocks & rules** — change any number, move a mechanic to a different company,
  repoint a reference, rewrite the reveal wording, restore one rule to its
  default, or duplicate a mechanic onto another company.
- **Configuration → Stocks & prices** — rename companies, change opening prices,
  and **add or remove companies entirely**.

### Adding and removing is not a plain insert or delete

Rules refer to each other, so a structural edit has to repair the rest of the
configuration. The engine does that and **tells you what it changed** rather than
doing it silently:

> *Airtight Construction followed Defense Steel; it now follows CoyoTech.*
>
> *Seasonal Financial now counts 8 companies, so its thresholds were raised to
> 5 rising / 4 falling to keep the two branches from overlapping.*

Specifically, removing a company repoints anything that followed it, compared
against it or watched it for secrets; drops it from any market-sentiment
universe; and adjusts the thresholds if they no longer fit. Adding one extends
universes that covered everything and raises thresholds if the larger market
would otherwise let both branches fire at once.

A property test runs arbitrary sequences of up to 25 additions and removals and
asserts the configuration is still playable after every single step.

---

## Saving your own

**Configuration → Save as template** keeps the current companies, mechanics,
numbers and settings as a reusable template. It is a snapshot: later changes to
that session do not affect it.

Saved templates appear in the picker alongside the built-ins, and can be edited
in place at **/admin/templates** — with the same rule cards a session uses — or
renamed, shared or deleted. Sharing makes a template startable by other
administrators, who cannot change it.

A template that would not run cannot be saved: the configuration is validated by
the engine first.

---

## Guarantees

Every claim here is tested in `src/engine/game-templates.test.ts` (47 tests):

- All twelve built-ins are `READY` out of the box, with no warnings.
- No company name is reused across templates.
- No two templates arrange the mechanics the same way.
- The library varies in stock count, round count and starting capital.
- At least one template inverts the holdings rule, at least one omits a
  mechanic, and at least one reuses a mechanic twice.
- Scrambling is deterministic for a seed and different across seeds.
- Scrambling never mutates its input, always preserves company names, count and
  session settings, and **never produces an error or a warning** — checked over
  randomised seeds for every template, with a full readiness check on a sample.
- A scrambled game never has a dangling or self-referencing rule, and its
  sentiment thresholds can never both fire.
- A scrambled scripted stock still opens at its own scheduled price.
- Scrambling carries no memory of the original assignment (the statistical test
  above).
- Adding and removing companies keeps every configuration playable and every
  rule explainable.

The API smoke test additionally creates a real session from **every** built-in
template with scrambling on and confirms each one passes its own readiness
check.
