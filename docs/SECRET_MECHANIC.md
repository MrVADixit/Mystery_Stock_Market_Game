# The secret mechanic

**IMPOSE A SECRET** lets a participant conceal one stock from everybody else for
a few rounds. It is the game's only tool for hiding what you are doing, and one
of the seven rules reacts to it directly.

---

## Timing

A secret imposed **during** round `A` covers rounds `A+1` through `A+duration`.

With the classic two-round duration:

```
Round 2:  the token is spent      →  nothing hidden yet
Round 3:  the secret is in force
Round 4:  the secret is in force
Round 5:  expired
```

The round it was imposed in is never covered. This matters: you cannot hide a
trade you are making right now, only the consequences of it.

Implementation: [`src/engine/secrets.ts`](../src/engine/secrets.ts).

---

## What it conceals

By default, for the affected stock:

- its price,
- its trading activity (gross buying and selling volume),
- its aggregate holdings.

Each of these is configurable independently.

Two further options are available:

- **Hide everyone's total asset figures** while any secret is active.
- **Mask the cash and asset summaries of participants who hold, buy or sell the
  affected stock** — a narrower version that only hides the people it would
  otherwise expose.

**Rankings always stay visible.** You can see who is first; you may not be able
to see by how much.

---

## The concealment window for history

A round's price, volume and holdings stay hidden **for as long as the secret
covering that round is still in force**. Once it expires, the history becomes
visible again.

```
Secret covers rounds 3–4.
During round 3:  rounds 3 and 4 are hidden
During round 4:  rounds 3 and 4 are hidden
During round 5:  rounds 3 and 4 are visible again
```

A price chart shows a gap for a concealed round rather than connecting across
it, so a secret is visible as a hole in the line and not as a misleading
straight segment.

A secret therefore buys **time**, not permanent cover. Everyone will eventually
see what happened; the question is whether they can still act on it.

---

## Anonymity

Other participants are never able to identify who imposed a secret.

This is enforced at three levels:

1. The projection in `state.ts` emits `activeStockIds` and nothing else — no
   participant identifier appears anywhere in the payload.
2. Realtime events carry only `{gameId, type, round}`. There is no event body
   that could name anybody.
3. The `secret_activations` table records the participant, but that column is
   only ever read by administrator-scoped queries.

The administrator always sees who imposed what, in the Dashboard and in the
participant audit.

---

## Trading during a secret

Two policies, configurable:

- **Enabled** (default) — trading continues normally. Participants trade at the
  concealed price, which they cannot see. This is the interesting version: the
  secret turns the stock into a gamble for everyone except the people who were
  already tracking it.
- **Suspended** — the stock cannot be traded while the secret is in force. The
  stock card says so and the buttons are disabled; the server refuses the order
  as well, so it is not a cosmetic restriction.

---

## Simultaneous secrets

By default several participants may target the same stock. If they do so **in
the same round**:

- every token is consumed,
- the stock receives exactly **one** normal secret period,
- durations are **not** added together.

This is a deliberate trap. Coordinating a secret with somebody else wastes a
token unless you stagger the rounds — and staggering them *does* extend the
window, because the periods union:

```
Imposed in round 2 and again in round 4, duration 2:
  rounds 3, 4, 5, 6 are covered
```

Two options change this:

- **Allow more than one secret on the same stock** — turn it off and a stock
  already covered cannot be targeted again until its secret expires.
- **Simultaneous activations extend the duration** — turn it on and `n` tokens
  spent in the same round give `n × duration` rounds.

---

## The rule that watches secrets

Rule 5 (Open Security by default) rises by 13% while a secret is active on a
nominated other stock, and falls 1,000 won otherwise.

The evaluation uses the secret state for the **round the new price is for**, not
the round that just closed. A secret imposed in round 2 is active from round 3,
so the settlement at the end of round 2 — which prices round 3 — already sees it.

The consequence is worth noticing as a player: the secret-dependent stock jumps
the moment a secret *starts*, which is a visible signal that somebody has just
hidden something. Secrecy in this game is never completely free.

If secrets are disabled for a session, this rule always takes its negative
branch, and the configuration validator warns about exactly that.

---

## Deadline

Secrets may be imposed up to the end of the configured round (20 by default).
After that the action is unavailable, and the server refuses it rather than
relying on the button being hidden.

---

## Administrator configuration

| Setting | Default |
|---|---|
| Secrets available | Yes |
| Tokens per participant | 1 |
| Duration | 2 rounds |
| Latest activation round | 20 |
| Conceals price | Yes |
| Conceals trading activity | Yes |
| Conceals aggregate holdings | Yes |
| Conceals everyone's asset figures | No |
| Masks holders' asset summaries | No |
| Trading during a secret | Continues |
| Simultaneous secrets allowed | Yes |
| Simultaneous activations extend duration | No |
