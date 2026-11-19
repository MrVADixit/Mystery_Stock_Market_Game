# Game handbook

The rules of Mystery Stock Market itself, independent of the software.

---

## The idea

Seven stocks are listed. Each one moves according to a rule that nobody has been
told. Everyone starts with the same cash. Over a fixed number of timed rounds
you buy and sell, watch what happens, and try to work out the mechanics — because
once you know how a stock moves, you can make it move.

The winner is whoever ends with the highest total assets.

---

## Twelve different games

The administrator picks which game you play from a library of twelve, each with
its own companies, its own arrangement of mechanics and its own numbers — and
usually scrambles it on top, which re-assigns everything again. So if you have
played before, what you remember about which company did what is not worth
anything. The *kinds* of mechanic are the same; which company runs which is not,
and one of them may even be reversed.

The table below is the classic configuration, which the rest of this handbook
uses as its example.

## The classic configuration

| Setting | Default |
|---|---|
| Stocks | 7 |
| Starting cash | 100,000 won |
| Initial price per stock | 10,000 won |
| Minimum price | 100 won |
| Rounds | 24 |
| Duration per round | 5 minutes |
| Rule disclosure events | 4 |
| Disclosure rounds | 5, 10, 15, 20 |
| Full disclosure | Round 20 |
| Secrets | Enabled, 1 per participant |
| Secret duration | 2 subsequent rounds |
| Secret deadline | End of round 20 |
| Intelligence | Enabled |
| Starting Pieces | 1 |
| Piece-to-cash exchange | 1 Piece = 10,000 won |
| Intelligence deadline | End of round 20 |

Every one of these is configurable per session. The defaults above are a preset,
not a hardcoded rule.

---

## A round

1. The round opens and a countdown starts.
2. You buy and sell at the round's prices. A price does not move *during* a
   round — only between them.
3. You may impose a secret or buy intelligence.
4. The round ends. Trading closes.
5. The market's statistics are frozen and the seven rules are evaluated against
   them, all at once.
6. New prices appear. The leaderboard updates.
7. At the configured rounds, a new fragment of every rule becomes public.

The key consequence: **what you do in a round affects the next round's prices,
not this one.** There is no way to act on a price change in the same round that
caused it.

---

## Trading

- You can only spend cash you have. There is no credit.
- You can only sell shares you hold. There is no short selling.
- Everything trades at the round's current price. There is no spread, no
  slippage and no partial fill.
- Cash from a sale is available immediately, in the same round.
- **MAX BUY** buys as many shares as you can afford. **ALL** sells your entire
  holding of a stock.

---

## What moves the prices

Each stock has one mechanic. The seven in the classic preset are:

1. **Holdings-based.** The price falls as the market's total holdings of it
   grow, and rises as they shrink. Everyone piling in pushes it down.
2. **Cross-stock.** It copies whether another named stock rose last round.
3. **Sweet spot.** It rewards the market for holding a particular quantity of
   it and punishes any other quantity.
4. **Relative buying volume.** It competes with another stock on how many shares
   were *bought* — purchases only; sales are not subtracted.
5. **Secret-dependent.** It rises while a secret is in force on a particular
   other stock, and bleeds otherwise.
6. **Market sentiment.** It reacts to how much of the whole market rose or fell.
7. **Scripted.** It follows a path decided before the game began. Nothing anyone
   does affects it at all.

Which stock has which mechanic is for you to work out — and in most sessions it
has been shuffled, so asking somebody who played last term will not help. One
warning worth taking seriously: the holdings rule is sometimes **reversed**, so
that buying pushes the price up rather than down. Check before you commit. The full formulas are in
[SEVEN_RULE_TEMPLATES.md](SEVEN_RULE_TEMPLATES.md) — read that only if you are
running the game, not playing it.

---

## The price floor

No stock can fall below the minimum price (100 won by default). A stock sitting
on the floor is not finished: the rule that drove it there can drive it back up
just as fast. Buying the floor is a real strategy, and so is watching for it.

---

## Secrets

You get one secret token. Spending it on a stock conceals that stock's price,
trading activity and total holdings from everyone else for the next two rounds.

- It takes effect the round **after** you use it. Use it in round 2 and it
  covers rounds 3 and 4, expiring before round 5.
- Nobody is told who imposed it. Everybody can see *that* a stock is concealed.
- Rankings stay visible throughout.
- Once it expires, the concealed history becomes visible again — so a secret
  buys you time, not permanent cover.
- Trading in the affected stock continues as normal by default.
- If several people target the same stock in the same round, every token is
  spent but the stock receives one normal secret period. Durations do not add up.

Full detail: [SECRET_MECHANIC.md](SECRET_MECHANIC.md).

---

## Intelligence

Each rule is written as four fragments that get progressively more specific,
ending in the complete formula. They become public at the four disclosure rounds.

You start with one **Piece**. Spending it on a stock privately gives you that
stock's next fragment — the next one in the sequence, ahead of everyone else. You
cannot pick an arbitrary hidden fragment, and you cannot buy something that is
already public.

A Piece can instead be exchanged for 10,000 won. That is the real decision: one
early clue, or ten percent more capital.

Full detail: [INTELLIGENCE.md](INTELLIGENCE.md).

---

## Winning

```
Final total assets = cash + market value of remaining holdings
```

Transaction costs and anything spent on intelligence have already come out of
the cash figure, so they are not subtracted again.

Everyone is ranked by final total assets. The results screen shows starting
capital, final cash, holdings value, net worth, absolute gain or loss and
percentage return for every participant.

---

## Three ways people win

**Crash and rebound.** Find the holdings-driven stock, accumulate it hard to
drive the price down, keep accumulating until it hits the floor, then sell into
the rebound your own selling creates. The risk is obvious: you are holding a
falling asset on purpose, and anyone else selling at the same time takes your
upside.

**Sweet-spot farming.** Find the stock with a preferred holdings band and park
the market's total holdings inside it, collecting the bonus every round. It
requires cooperation you cannot enforce — and one person buying a single extra
share tips it outside the band for everybody.

**Compounding.** One action can move three rules. Selling the holdings-driven
stock pushes its price up; the stock that follows it rises too; two rising
stocks bring the market-wide sentiment rule closer to its positive branch. The
players who win large usually found a chain like this and were not the ones who
told anybody about it.

The administrator can replay all three against the configured rules in the
simulation screen and see what they actually produce.
