# Administrator guide

How to run a session from start to finish, without writing any code.

---

## The short version

1. Sign in at `/admin`.
2. **New session** → pick a template → name it → **Create session**.
3. **Simulation & testing** → **TEST MY GAME**.
4. **Dashboard** → **Open registration**. Share the join link.
5. **Dashboard** → **Start the game**.
6. Watch. Everything runs itself.

Every template is already a complete, playable game. You do not have to change
anything.

---

## Choosing a game

**New session** opens the template gallery: twelve ready-made games, your own
saved templates, and a from-scratch option.

Each card shows the theme, how many companies, how many rounds, a description
and a designer's note about how it plays. Expand *Show which mechanic each
company runs* to see the answer key — that is for you, not the class.

A few worth knowing:

- **Classic Mystery Stock Market** — the original seven. The reference game.
- **Greenfield** — gentle, smaller movements, nobody is wiped out in round
  three. The best first game for a class that has not played before.
- **Neon District** — the most volatile. Short rounds, expect a floor hit.
- **Monsoon** — the holdings rule is inverted: buying pushes the price *up*.
- **Tidal Reach** — six companies, twelve rounds, one lesson. One mechanic is
  missing entirely.
- **Cascade** — eight companies over thirty rounds, with two competing sweet
  spots the market cannot satisfy at once.

The full list is in [GAME_TEMPLATES.md](GAME_TEMPLATES.md).

**Build from scratch** creates the number of companies you ask for, all doing
nothing, for you to assign mechanics to yourself.

### Scrambling — leave it on

The toggle under the gallery is the most important setting on the screen.

With it on, the session re-assigns which company runs which mechanic, repoints
every cross-reference, varies all the numbers, and about a third of the time
reverses whether buying pushes a price up or down. A participant who has played
that template before gets **no head start** — a company keeps its original
mechanic about as often as pure chance would give.

Turn it off only when you specifically want the published version, for example
the first time you run Classic and want it to match the documentation.

The **seed** box underneath controls reproducibility. Leave it blank for a fresh
puzzle every time. Note the seed down (it is shown on the session afterwards) and
reuse it to recreate exactly the same game for a second class.

### Editing afterwards

Whichever you pick, you can change anything right up until the game starts. Your
edits are held as a draft; a bar appears at the top of the screen until you
**Save** or **Discard** them.

### Picking a length

| Rounds | Duration | Total | Good for |
|---|---|---|---|
| 8 | 2 minutes | ~16 min | A single short lesson |
| 12 | 3 minutes | ~36 min | A standard period |
| 24 | 5 minutes | ~2 hours | The full classic game |

Shorter rounds make the game frantic and reward quick arithmetic; longer rounds
reward discussion and deduction. The reveal schedule rescales automatically.

---

## The configuration wizard

Seven numbered sections. Nothing is mandatory.

**General** — name, starting cash, rounds, round duration, the price floor, an
optional ceiling and an optional per-round movement cap. The last two are off by
default so the classic mechanics are untouched.

**Stocks & prices** — rename the companies, set their opening prices, and **add
or remove companies**. A company running the scripted path takes its round 1
price from its schedule.

Adding and removing is not a plain insert or delete, because rules refer to each
other. The system repairs the rest of the configuration and tells you what it
changed:

> *Airtight Construction followed Defense Steel; it now follows CoyoTech.*
>
> *Seasonal Financial now counts 8 companies, so its thresholds were raised to
> 5 rising / 4 falling to keep the two branches from overlapping.*

A new company starts on the unchanged-price mechanic; give it a real one on the
**Stocks & rules** tab.

**Secrets** — availability, tokens per participant, duration, the latest round a
secret may be imposed, exactly what a secret conceals, whether trading continues
in the affected stock, and how simultaneous secrets behave.

**Intelligence & Pieces** — Pieces, a fixed cash price, or intelligence disabled
entirely. Starting Pieces, the exchange rate and the purchase deadline.

**Rule reveals** — the four disclosure rounds. Each must come after the one
before it.

**Trading limits** — optional caps on the shares in one order and on how much of
one stock a participant may hold.

**Public information** — whether aggregate holdings, volumes, the leaderboard
and individual asset figures are shown to participants and on the display board.

---

## The rule cards

**Stocks & rules** shows seven cards. Each one gives you, at a glance: which
stock it is assigned to, the name of the mechanic, the formula in plain English
with your numbers filled in, and whether its checks pass.

Each card has:

- **Edit** — change the numbers, the reference stocks and the reveal wording.
- **Preview** — set a hypothetical market state and settle one round through the
  real engine. Nothing touches the live session.
- **Restore default** — put that rule back to the classic preset.
- **Duplicate to…** — copy this mechanic onto another stock.

You can also change a stock's mechanic entirely from the dropdown at the top of
the editor. Stock names and rule templates are completely independent.

### What you can and cannot change

You can change every number, every threshold, every percentage and every stock
reference. You cannot change the *structure* of a rule — there is no formula
editor — and that is deliberate: it is what makes the rule library testable.

### Saving your own template

**Configuration → Save as template** keeps the current companies, mechanics,
numbers and settings for reuse. It is a snapshot — later changes to this session
will not affect it.

Saved templates appear in the gallery next to the built-ins. Manage them at
**Templates** in the header: edit one in place with the same rule cards, rename
it, share it with other administrators (they can start sessions from it but not
change it), or delete it.

A template that would not run cannot be saved — it is validated first.

### Risk warnings

High volatility is a legitimate design choice, so the system explains rather than
refuses. If you set Defense Steel to 2,000 won per share, you will see:

> Defense Steel: a 5-share increase in total holdings takes this stock to its
> 100 won floor in a single round, and one participant alone can buy up to 10
> shares.

That is a warning, not an error. The game will still start. For the most extreme
settings you are asked to acknowledge that you meant them, after looking at the
simulated effect.

Genuine mistakes — a reference to a stock that does not exist, a scripted path
missing prices, overlapping sentiment thresholds, reveal rounds out of order —
are errors and do block the game, with a direct link to the card that needs
fixing.

---

## TEST MY GAME

One button, in **Simulation & testing**. It runs three layers:

1. **Validation** of the whole configuration.
2. **A probe of every assigned rule**, where the expected figure is worked out
   independently of the engine rather than by calling the same function and
   comparing it with itself.
3. **A real simulation** of your game — your stocks, your rules, your settings —
   across fifteen scenarios including a complete play-through.

You get one of three verdicts:

- **READY** — everything passed, no warnings.
- **READY WITH WARNINGS** — everything passed; some settings are worth a look.
- **NEEDS CORRECTION** — something must be fixed first.

The report lists the tests passed, the warnings, the invalid settings, the rounds
where a stock will hit the price floor, and any movement of 50% or more. A game
is never reported ready merely because its configuration parses.

---

## The simulation screen

**Quick checks** — seven one-press scenarios: nobody trades, steady buying,
steady selling, a secret is activated, a broad rally, the sweet spot is exceeded,
and the full game.

**One-off check** — pick a stock, pick what happens (participants buy, buy then
sell, or hold total holdings at a level), set the quantity, optionally impose a
secret in a chosen round, and run it.

**Strategic demonstrations** — the three sample strategies, reconstructed as real
trade sequences and replayed through your actual rules, cash limits, holdings
limits, price floor and secret timing. No profit figure is assumed: these
validate the model, they do not promise an outcome.

Every simulation reads your stored configuration and runs in memory. None of
them can alter a live session.

---

## Inviting participants

**Participants** shows the join link and the code in large type. Everyone uses
the same link. The code avoids characters people confuse (no 0/O, no 1/I/L).

Registration must be open before anyone can join, and closes automatically when
you start the game.

If a participant loses connection, they return with the same name and passphrase
and their account is restored from the database.

---

## Running the game

The **Dashboard** is your control room:

- The round, the countdown, how many participants are connected.
- Every price, every holdings total, every volume — nothing is hidden from you.
- Any active secrets, **including who imposed them**. Participants never see
  that.
- The most recent transactions, live.
- The rankings.
- A box to send an announcement to every participant and the display board.

Controls: **Pause**, **Resume**, **End this round now** (settles immediately and
opens the next), and **Finish the game**.

You do not have to do anything. Rounds close and settle on their own.

---

## The classroom display board

**Dashboard → Generate a display link** gives you a URL for a projector. It needs
no login at all, cannot trade, cannot reach any administrator control, does not
reveal hidden rules, respects active secrets, and is excluded from search
indexing. You can regenerate it or revoke it at any time; revoking stops the open
page working immediately.

Leave it on the projector for the whole lesson.

---

## Watching what happened

**Market activity** shows, for any settled round: the opening price, the previous
close, aggregate holdings, the change in holdings, buying and selling volumes,
which branch of the rule fired, the movement applied and the final price — plus
the arithmetic written out in words for every stock. You can also open the exact
frozen snapshot the settlement was computed from.

**Participants → Audit** opens a private, chronological record of one
participant: every trade with timestamp, round, stock, action, quantity,
execution price, amount, cash before and after and holdings before and after;
their intelligence purchases, secret activations and reconnections; and their
portfolio value and rank after each round. You can filter by round, stock,
action and time.

This is for you alone. Participants have no route to each other's history.

---

## Results and export

**Final results** shows the complete ranking with starting capital, final cash,
holdings value, net worth, gain or loss and percentage return, and lets you open
each participant's remaining holdings.

Eight CSV exports: overall ranking, participant portfolios, the full transaction
history, round-by-round prices, trading statistics, rule-trigger history, secret
activity and intelligence purchases.

When you are finished, **Archive** the session. The complete event history
remains available afterwards.

---

## The AI assistant (optional)

If the server has an `ANTHROPIC_API_KEY`, **Simulation & testing** includes an
assistant that can explain the templates, suggest parameters, interpret a test
report and talk through volatility.

It can read your configuration and ask the engine to run the same readiness
check, previews and simulations you can press yourself. Every number it quotes
comes from one of those calls, and the calls are listed underneath its answer so
you can check them. It never changes a setting — you make every change.

Without a key it shows as unconfigured and everything else works normally. No
price, rule, settlement, portfolio figure or ranking in this game ever comes from
a model.

---

## Troubleshooting

**The game will not start.** The readiness check found blocking errors. Open
**TEST MY GAME** and follow the links to the cards that need fixing.

**My class has played this before.** Create the session with scrambling on, or
pick a different template — no two templates share a company name or an
arrangement of mechanics.

**I want both classes to play the identical game.** Note the seed shown on the
first session (Configuration → Template) and type it into the seed box when you
create the second.

**A participant cannot join.** Registration is either not open yet or has closed
because the game started. Check the status chip in the header.

**Somebody took the wrong name.** Names are unique per game and reconnection
depends on them. If someone genuinely needs a new identity, they can register
again under a different name while registration is open.

**The clock looks frozen on a participant's phone.** The server is authoritative;
their device is reconnecting. Their account and holdings are safe, and the page
catches up by itself.

**A stock is stuck on the floor.** That is the rule working. It will come back up
as soon as the market's behaviour reverses — which is usually the lesson.
