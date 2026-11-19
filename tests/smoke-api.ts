/**
 * API-level smoke test of the whole game loop.
 *
 * Drives a real session through registration, trading, secrets, intel,
 * settlement and final results against a running server and database.
 */

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

class Session {
  private cookies = new Map<string, string>();

  async call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
    const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
    if (init?.body) headers['Content-Type'] = 'application/json';
    if (this.cookies.size > 0) {
      headers.Cookie = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    const response = await fetch(`${BASE}${path}`, { ...init, headers, redirect: 'manual' });
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const index = pair.indexOf('=');
      if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: response.status, body: body as T };
  }
}

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ''}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`\nMystery Stock Market — API smoke test against ${BASE}\n`);

  /* ---------------- administrator ---------------- */
  console.log('Administrator');
  const admin = new Session();
  const login = await admin.call<{ email: string }>('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'owner@example.com', password: 'ownerpass123' }),
  });
  check('signs in', login.status === 200, login.body);

  const created = await admin.call<{ gameId: string; joinCode: string }>('/api/admin/games', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Smoke Test Session',
      preset: 'classic',
      rounds: 6,
      roundSeconds: 8,
    }),
  });
  check('creates a session from the classic preset', created.status === 201, created.body);
  const gameId = created.body.gameId;
  const joinCode = created.body.joinCode;

  const config = await admin.call<{ config: { stocks: { id: string; name: string }[]; rounds: number }; issues: unknown[] }>(
    `/api/admin/games/${gameId}/config`,
  );
  check('loads the configuration', config.status === 200);
  check('has seven stocks', config.body.config.stocks.length === 7, config.body.config.stocks.length);
  check('has no blocking configuration issues', (config.body.issues as { level: string }[]).every((i) => i.level !== 'error'));
  const stocks = config.body.config.stocks;
  const defenseSteel = stocks.find((s) => s.name === 'Defense Steel')!.id;
  const latter = stocks.find((s) => s.name === 'Latter Electronics')!.id;

  // Change a few numbers and one reference stock, as §23 steps 4-5 require.
  const edited = structuredClone(config.body.config) as typeof config.body.config & {
    stocks: { id: string; rule: Record<string, unknown> }[];
  };
  for (const stock of edited.stocks) {
    if (stock.rule.template === 'HOLDINGS_DELTA') stock.rule.wonPerShare = 300;
    if (stock.rule.template === 'CROSS_STOCK_DIRECTION') stock.rule.referenceStockId = latter;
  }
  const saved = await admin.call(`/api/admin/games/${gameId}/config`, {
    method: 'PUT',
    body: JSON.stringify(edited),
  });
  check('saves edited numbers and a new reference stock', saved.status === 200, saved.body);

  const readiness = await admin.call<{ verdict: string; testsPassed: number; testsFailed: number; scenarios: { id: string; roundsRun: number }[] }>(
    `/api/admin/games/${gameId}/readiness`,
    { method: 'POST' },
  );
  check('TEST MY GAME returns a verdict', readiness.status === 200, readiness.body);
  check(
    `readiness is READY or READY_WITH_WARNINGS (got ${readiness.body.verdict})`,
    readiness.body.verdict !== 'NEEDS_CORRECTION',
  );
  check('every readiness check passed', readiness.body.testsFailed === 0, readiness.body.testsFailed);
  check('the rule probes ran', readiness.body.testsPassed > 20, readiness.body.testsPassed);
  check(
    'the full-game simulation ran every round',
    readiness.body.scenarios.find((s) => s.id === 'full-game')?.roundsRun === 6,
  );

  const display = await admin.call<{ token: string }>(`/api/admin/games/${gameId}/display-token`, {
    method: 'POST',
  });
  check('generates a display token', display.status === 200 && display.body.token.length > 20);
  const displayToken = display.body.token;

  const opened = await admin.call(`/api/admin/games/${gameId}/lifecycle`, {
    method: 'POST',
    body: JSON.stringify({ action: 'open-registration' }),
  });
  check('opens registration', opened.status === 200, opened.body);

  /* ---------------- participants ---------------- */
  console.log('\nParticipants');
  const players: { name: string; session: Session }[] = [];
  for (const name of ['Ada', 'Grace', 'Linus', 'Hedy']) {
    const session = new Session();
    const joined = await session.call<{ gameId: string }>('/api/join', {
      method: 'POST',
      body: JSON.stringify({ joinCode, displayName: name, passphrase: 'pass1234' }),
    });
    check(`${name} registers`, joined.status === 200, joined.body);
    players.push({ name, session });
  }

  const duplicate = await new Session().call('/api/join', {
    method: 'POST',
    body: JSON.stringify({ joinCode, displayName: 'Ada', passphrase: 'wrongpass' }),
  });
  check('a wrong passphrase on an existing name is rejected', duplicate.status === 401, duplicate.body);

  const reconnect = new Session();
  const again = await reconnect.call<{ reconnected: boolean }>('/api/join', {
    method: 'POST',
    body: JSON.stringify({ joinCode, displayName: 'Ada', passphrase: 'pass1234' }),
  });
  check('a participant can reconnect with the same credentials', again.status === 200 && again.body.reconnected);

  const beforeStart = await players[0].session.call<{ game: { status: string } }>('/api/play/state');
  check('state is available before the game starts', beforeStart.status === 200);
  const earlyTrade = await players[0].session.call('/api/play/trade', {
    method: 'POST',
    body: JSON.stringify({ stockId: defenseSteel, side: 'buy', quantity: 1, idempotencyKey: 'early-trade-key' }),
  });
  check('trading before the game starts is refused', earlyTrade.status === 409, earlyTrade.body);

  /* ---------------- start ---------------- */
  console.log('\nStarting the game');
  const started = await admin.call(`/api/admin/games/${gameId}/lifecycle`, {
    method: 'POST',
    body: JSON.stringify({ action: 'start' }),
  });
  check('starts the game', started.status === 200, started.body);

  const lateJoin = await new Session().call('/api/join', {
    method: 'POST',
    body: JSON.stringify({ joinCode, displayName: 'TooLate', passphrase: 'pass1234' }),
  });
  check('registration closes when the game starts', lateJoin.status === 409, lateJoin.body);

  const state1 = await players[0].session.call<{
    game: { round: number; secondsRemaining: number; status: string };
    me: { cash: number; totalAssets: number };
    stocks: { id: string; price: number; myHoldings: number }[];
  }>('/api/play/state');
  check('round 1 is live', state1.body.game.round === 1 && state1.body.game.status === 'running');
  check('the countdown is running', state1.body.game.secondsRemaining > 0 && state1.body.game.secondsRemaining <= 8);
  check('starting cash is 100,000', state1.body.me.cash === 100_000, state1.body.me.cash);
  check('every stock has a price', state1.body.stocks.every((s) => s.price > 0));

  /* ---------------- trading ---------------- */
  console.log('\nTrading');
  const buy = await players[0].session.call<{ receipt: { quantity: number; price: number; amount: number }; state: { me: { cash: number } } }>(
    '/api/play/trade',
    {
      method: 'POST',
      body: JSON.stringify({ stockId: defenseSteel, side: 'buy', quantity: 3, idempotencyKey: 'ada-buy-1' }),
    },
  );
  check('a buy executes', buy.status === 200, buy.body);
  check('cash is reduced by exactly price x quantity', buy.body.state.me.cash === 100_000 - buy.body.receipt.amount);

  const replay = await players[0].session.call<{ receipt: { quantity: number }; state: { me: { cash: number } } }>(
    '/api/play/trade',
    {
      method: 'POST',
      body: JSON.stringify({ stockId: defenseSteel, side: 'buy', quantity: 3, idempotencyKey: 'ada-buy-1' }),
    },
  );
  check('the same idempotency key does not trade twice', replay.body.state.me.cash === buy.body.state.me.cash);

  const overspend = await players[0].session.call<{ error: string }>('/api/play/trade', {
    method: 'POST',
    body: JSON.stringify({ stockId: defenseSteel, side: 'buy', quantity: 999, idempotencyKey: 'ada-overspend' }),
  });
  check('overspending is refused', overspend.status === 422, overspend.body);

  const oversell = await players[1].session.call('/api/play/trade', {
    method: 'POST',
    body: JSON.stringify({ stockId: defenseSteel, side: 'sell', quantity: 1, idempotencyKey: 'grace-oversell' }),
  });
  check('overselling is refused', oversell.status === 422, oversell.body);

  const maxBuy = await players[1].session.call<{ receipt: { quantity: number }; state: { me: { cash: number } } }>(
    '/api/play/trade',
    {
      method: 'POST',
      body: JSON.stringify({ stockId: latter, side: 'buy', quantity: 'max', idempotencyKey: 'grace-max' }),
    },
  );
  check('MAX BUY buys the most affordable whole quantity', maxBuy.status === 200 && maxBuy.body.receipt.quantity === 10, maxBuy.body);
  check('MAX BUY leaves no cash behind', maxBuy.body.state.me.cash === 0, maxBuy.body.state.me.cash);

  // Concurrent orders from the same participant must serialise.
  const concurrent = await Promise.all(
    [1, 2, 3, 4, 5].map((i) =>
      players[2].session.call<{ error?: string }>('/api/play/trade', {
        method: 'POST',
        body: JSON.stringify({
          stockId: latter,
          side: 'buy',
          quantity: 3,
          idempotencyKey: `linus-concurrent-${i}`,
        }),
      }),
    ),
  );
  const accepted = concurrent.filter((r) => r.status === 200).length;
  const afterConcurrent = await players[2].session.call<{ me: { cash: number } }>('/api/play/state');
  check(
    `concurrent orders never overspend (${accepted} accepted, cash ${afterConcurrent.body.me.cash})`,
    afterConcurrent.body.me.cash >= 0,
  );

  /* ---------------- secrets and intel ---------------- */
  console.log('\nSecrets and intelligence');
  const secret = await players[3].session.call<{ receipt: { firstRound: number; lastRound: number } }>(
    '/api/play/secret',
    { method: 'POST', body: JSON.stringify({ stockId: latter }) },
  );
  check('a secret can be imposed', secret.status === 200, secret.body);
  check(
    'a secret covers the two rounds after the one it was imposed in',
    secret.body.receipt.lastRound - secret.body.receipt.firstRound === 1,
    secret.body.receipt,
  );

  const secondSecret = await players[3].session.call('/api/play/secret', {
    method: 'POST',
    body: JSON.stringify({ stockId: defenseSteel }),
  });
  check('a participant cannot impose a second secret without a token', secondSecret.status === 409, secondSecret.body);

  // Whatever is already public is not worth selling, so the next fragment
  // on offer is the first one past the public ones.
  const beforeIntel = await players[0].session.call<{
    rules: { stockId: string; publicSegments: { index: number }[] }[];
  }>('/api/play/state');
  const alreadyPublic =
    beforeIntel.body.rules.find((r) => r.stockId === defenseSteel)?.publicSegments.length ?? 0;

  const intel = await players[0].session.call<{ receipt: { segmentIndex: number; text: string; piecesRemaining: number } }>(
    '/api/play/intel',
    { method: 'POST', body: JSON.stringify({ stockId: defenseSteel }) },
  );
  check('intelligence can be bought', intel.status === 200, intel.body);
  check(
    `it returns the next fragment past the ${alreadyPublic} already public`,
    intel.body.receipt.segmentIndex === alreadyPublic,
    intel.body.receipt,
  );
  check('the fragment has real content', intel.body.receipt.text.length > 20);
  check('the Piece is spent', intel.body.receipt.piecesRemaining === 0);

  const intelAgain = await players[0].session.call('/api/play/intel', {
    method: 'POST',
    body: JSON.stringify({ stockId: latter }),
  });
  check('a second purchase without a Piece is refused', intelAgain.status === 409, intelAgain.body);

  /* ---------------- redaction ---------------- */
  console.log('\nSecret redaction');
  await sleep(9000); // let round 1 settle so the secret becomes active
  const duringSecret = await players[0].session.call<{
    game: { round: number };
    stocks: { id: string; price: number | null; secretActive: boolean; aggregateHoldings: number | null }[];
  }>('/api/play/state');
  const hidden = duringSecret.body.stocks.find((s) => s.id === latter)!;
  check(`round advanced to ${duringSecret.body.game.round}`, duringSecret.body.game.round >= 2);
  check('the secret is active on the targeted stock', hidden.secretActive, hidden);
  check('its price is withheld from participants', hidden.price === null, hidden);
  check('its aggregate holdings are withheld', hidden.aggregateHoldings === null, hidden);

  // A participant's payload may carry their own id, but must never carry
  // anyone else's, and must never say who imposed a secret.
  const roster = await admin.call<{ participants: { id: string; displayName: string }[] }>(
    `/api/admin/games/${gameId}/participants`,
  );
  const myId = (await players[0].session.call<{ me: { participantId: string } }>('/api/play/state')).body.me
    .participantId;
  const raw = JSON.stringify(duringSecret.body);
  const leakedIds = roster.body.participants.filter((p) => p.id !== myId && raw.includes(p.id));
  check('no other participant id appears in the payload', leakedIds.length === 0, leakedIds);
  // The payload says which stocks are concealed, never by whom.
  check('the payload carries no secret-creator field', !raw.includes('imposedBy'));
  check(
    'the payload names the concealed stock but not its author',
    raw.includes('activeStockIds') && !raw.includes('activatedBy'),
  );

  const adminView = await admin.call<{
    stocks: { id: string; price: number | null }[];
    admin: { activeSecrets: { imposedBy: string }[] };
  }>(`/api/admin/games/${gameId}/state`);
  const adminStock = adminView.body.stocks.find((s) => s.id === latter)!;
  check('the administrator still sees the concealed price', adminStock.price !== null, adminStock);
  check('the administrator sees who imposed the secret', adminView.body.admin.activeSecrets.length > 0);

  const displayState = await fetch(`${BASE}/api/display/${gameId}/state?token=${encodeURIComponent(displayToken)}`);
  const displayBody = (await displayState.json()) as {
    stocks: { id: string; price: number | null }[];
    rules: { lockedCount: number }[];
  };
  check('the display board loads with its token and no login', displayState.status === 200);
  check(
    'the display board respects the secret',
    displayBody.stocks.find((s) => s.id === latter)?.price === null,
  );
  check('the display board does not reveal hidden rules', displayBody.rules.some((r) => r.lockedCount > 0));

  const noToken = await fetch(`${BASE}/api/display/${gameId}/state`);
  check('the display board refuses a missing token', noToken.status === 403);
  const badToken = await fetch(`${BASE}/api/display/${gameId}/state?token=not-a-real-token`);
  check('the display board refuses a wrong token', badToken.status === 403);

  const anonTrade = await new Session().call('/api/play/trade', {
    method: 'POST',
    body: JSON.stringify({ stockId: latter, side: 'buy', quantity: 1, idempotencyKey: 'anon-attempt-key' }),
  });
  check('an unauthenticated trade is refused', anonTrade.status === 401);

  const anonAdmin = await new Session().call(`/api/admin/games/${gameId}/state`);
  check('an unauthenticated admin request is refused', anonAdmin.status === 401);

  /* ---------------- settlement ---------------- */
  console.log('\nSettlement');
  const settlement = await admin.call<{
    stocks: { stockName: string; holdingsChange: number; grossBuys: number; grossSells: number; calculation: string; finalPrice: number }[];
    frozenSnapshot: unknown;
  }>(`/api/admin/games/${gameId}/settlement/1`);
  check('round 1 settlement is recorded', settlement.status === 200, settlement.body);
  check('it keeps the frozen snapshot', settlement.body.frozenSnapshot !== null);
  check('it explains every stock', settlement.body.stocks.every((s) => s.calculation.length > 10));
  const steelRow = settlement.body.stocks.find((s) => s.stockName === 'Defense Steel')!;
  check('holdings change is tracked separately from volume', steelRow.holdingsChange === steelRow.grossBuys - steelRow.grossSells, steelRow);

  /* ---------------- run to the end ---------------- */
  console.log('\nRunning the game to the end');
  for (let i = 0; i < 40; i++) {
    const s = await players[0].session.call<{ game: { status: string; round: number } }>('/api/play/state');
    if (s.body.game.status === 'finished') break;
    // Keep trading so later rounds have real activity.
    if (i % 2 === 0) {
      await players[1].session.call('/api/play/trade', {
        method: 'POST',
        body: JSON.stringify({ stockId: defenseSteel, side: 'buy', quantity: 1, idempotencyKey: `loop-${i}` }),
      });
    }
    await sleep(3000);
  }

  const finished = await players[0].session.call<{ game: { status: string; round: number } }>('/api/play/state');
  check(`the game finished (status ${finished.body.game.status})`, finished.body.game.status === 'finished');

  const closedTrade = await players[0].session.call('/api/play/trade', {
    method: 'POST',
    body: JSON.stringify({ stockId: defenseSteel, side: 'buy', quantity: 1, idempotencyKey: 'after-end-key' }),
  });
  check('trading is refused after the game ends', closedTrade.status === 409, closedTrade.body);

  const results = await admin.call<{
    standings: { rank: number; displayName: string; netWorth: number; finalCash: number; holdingsValue: number }[];
  }>(`/api/results/${gameId}`);
  check('final results are produced', results.status === 200, results.body);
  check('every participant is ranked', results.body.standings.length === 4, results.body.standings.length);
  check(
    'net worth is cash plus holdings value for everyone',
    results.body.standings.every((s) => s.netWorth === s.finalCash + s.holdingsValue),
  );
  check('ranks are in descending order of net worth', results.body.standings.every((s, i, all) => i === 0 || all[i - 1].netWorth >= s.netWorth));

  /* ---------------- audit and export ---------------- */
  console.log('\nAudit and export');
  const participants = await admin.call<{ participants: { id: string; displayName: string }[] }>(
    `/api/admin/games/${gameId}/participants`,
  );
  const ada = participants.body.participants.find((p) => p.displayName === 'Ada')!;
  const audit = await admin.call<{
    transactions: { quantity: number; cashBefore: number; cashAfter: number }[];
    timeline: unknown[];
    roundValues: unknown[];
  }>(`/api/admin/games/${gameId}/participants/${ada.id}/audit`);
  check('the participant audit loads', audit.status === 200);
  check('it lists her transactions with before/after balances', audit.body.transactions.length > 0 && audit.body.transactions.every((t) => t.cashBefore !== t.cashAfter));
  check('it has a chronological timeline', audit.body.timeline.length > 0);
  check('it records a value for each settled round', audit.body.roundValues.length > 0);

  const filtered = await admin.call<{ transactions: { round: number }[] }>(
    `/api/admin/games/${gameId}/participants/${ada.id}/audit?round=1&side=buy`,
  );
  check('audit filters work', filtered.body.transactions.every((t) => t.round === 1));

  for (const kind of ['ranking', 'portfolios', 'transactions', 'prices', 'statistics', 'rule-triggers', 'secrets', 'intel']) {
    const response = await fetch(`${BASE}/api/admin/games/${gameId}/export?kind=${kind}`, {
      headers: { Cookie: '' },
    });
    check(`the ${kind} export refuses an anonymous request`, response.status === 401);
  }
  const exportRanking = await admin.call<string>(`/api/admin/games/${gameId}/export?kind=ranking`);
  check('the ranking export returns CSV', typeof exportRanking.body === 'string' && (exportRanking.body as string).includes('rank,participant'));

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
