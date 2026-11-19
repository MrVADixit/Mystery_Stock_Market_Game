/**
 * Checks a deployed Mystery Stock Market from the outside, as a participant.
 *
 * It needs no administrator password: you create a session in the browser,
 * open registration, and give this script the join code.
 *
 *   BASE_URL=https://your-app.onrender.com JOIN_CODE=ABC123 npm run test:live
 *
 * It registers two participants called "ZZ Live Check 1" and "2", so run it
 * against a throwaway session rather than the one your class will use.
 */

const BASE = (process.env.BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const JOIN_CODE = process.env.JOIN_CODE ?? '';
const PASSPHRASE = 'live-check-passphrase';

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
      const i = pair.indexOf('=');
      if (i > 0) this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
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
const failures: string[] = [];

function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  FAIL ${label}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ''}`);
  }
}

interface PlayState {
  game: { id: string; name: string; status: string; round: number; totalRounds: number; secondsRemaining: number };
  me?: { cash: number; startingCash: number; totalAssets: number; pieces: number; secretTokens: number; participantId: string };
  stocks: { id: string; name: string; price: number | null; myHoldings?: number; secretActive: boolean }[];
  rules: { stockId: string; publicSegments: unknown[]; lockedCount: number }[];
  secrets: { enabled: boolean; myTokens: number };
  intel: { mode: string };
}

async function main() {
  console.log(`\nLive check of ${BASE}\n`);

  // Node's fetch ignores HTTPS_PROXY unless told to use it, which produces a
  // confusing DNS error rather than a proxy error. Say so up front.
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (proxy && !process.env.NODE_USE_ENV_PROXY) {
    console.log(`  note: a proxy is configured (${proxy}) but Node's fetch will not use it.`);
    console.log('        Re-run with NODE_USE_ENV_PROXY=1 if the connection fails.\n');
  }

  /* ---------------- reachable and serving ---------------- */
  console.log('The deployment');
  const home = await fetch(BASE);
  const html = await home.text();
  check('the home page loads', home.status === 200);
  check('it is this application', html.includes('Mystery Stock Market'));
  check('it is served over HTTPS', BASE.startsWith('https://') || BASE.includes('127.0.0.1'));
  check('clickjacking protection is set', home.headers.get('x-frame-options') === 'DENY');
  check('MIME sniffing is disabled', home.headers.get('x-content-type-options') === 'nosniff');

  const anon = new Session();
  const badLogin = await anon.call<{ error: string }>('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'nobody@example.invalid', password: 'definitely-wrong' }),
  });
  // A 401 means the query reached the database. A 500 would mean it did not.
  check('the database is connected and migrated', badLogin.status === 401, badLogin.body);
  check('a wrong password is refused', badLogin.status === 401);

  const noAuthState = await anon.call('/api/play/state');
  check('an unauthenticated player request is refused', noAuthState.status === 401);
  const noAuthAdmin = await anon.call('/api/admin/games');
  check('an unauthenticated admin request is refused', noAuthAdmin.status === 401);

  if (!JOIN_CODE) {
    console.log(`\n${passed} passed, ${failed} failed`);
    console.log('\nSet JOIN_CODE to also test registering, trading and the secret rules.\n');
    process.exit(failed === 0 ? 0 : 1);
  }

  /* ---------------- registration ---------------- */
  console.log('\nRegistration');
  const players: { name: string; session: Session }[] = [];
  for (const n of [1, 2]) {
    const name = `ZZ Live Check ${n}`;
    const session = new Session();
    const joined = await session.call<{ gameId: string }>('/api/join', {
      method: 'POST',
      body: JSON.stringify({ joinCode: JOIN_CODE, displayName: name, passphrase: PASSPHRASE }),
    });
    check(`${name} can register`, joined.status === 200, joined.body);
    if (joined.status !== 200) {
      console.log('\nCannot continue without a registered participant.');
      console.log(`${passed} passed, ${failed} failed\n`);
      process.exit(1);
    }
    players.push({ name, session });
  }

  const wrongPass = await new Session().call('/api/join', {
    method: 'POST',
    body: JSON.stringify({ joinCode: JOIN_CODE, displayName: 'ZZ Live Check 1', passphrase: 'not-the-passphrase' }),
  });
  check('somebody else cannot take a registered name', wrongPass.status === 401);

  const reconnected = new Session();
  const again = await reconnected.call<{ reconnected: boolean }>('/api/join', {
    method: 'POST',
    body: JSON.stringify({ joinCode: JOIN_CODE, displayName: 'ZZ Live Check 1', passphrase: PASSPHRASE }),
  });
  check('a participant can reconnect to the same account', again.status === 200 && again.body.reconnected);

  /* ---------------- state ---------------- */
  console.log('\nGame state');
  const first = await players[0].session.call<PlayState>('/api/play/state');
  check('a participant can read the game state', first.status === 200, first.body);
  const state = first.body;
  console.log(`       game "${state.game.name}" — status ${state.game.status}, round ${state.game.round}/${state.game.totalRounds}`);
  check('the stocks are configured', state.stocks.length >= 1, state.stocks.length);
  check('starting cash was granted', (state.me?.cash ?? 0) > 0, state.me?.cash);
  check('the rules are hidden to begin with', state.rules.some((r) => r.lockedCount > 0));

  const other = await players[1].session.call<PlayState>('/api/play/state');
  const raw = JSON.stringify(other.body);
  check(
    'one participant cannot see another participant id',
    !raw.includes(state.me?.participantId ?? '\u0000'),
  );

  if (state.game.status !== 'running') {
    console.log(`\nThe game is "${state.game.status}", so trading was not tested.`);
    console.log('Start the game and run this again to test trading, intelligence and secrets.');
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failures.length) console.log(`failures: ${failures.join(', ')}`);
    process.exit(failed === 0 ? 0 : 1);
  }

  /* ---------------- trading ---------------- */
  console.log('\nTrading');
  const stock = state.stocks.find((s) => s.price != null)!;
  const cashBefore = state.me!.cash;

  const buy = await players[0].session.call<{
    receipt: { quantity: number; price: number; amount: number };
    state: PlayState;
  }>('/api/play/trade', {
    method: 'POST',
    body: JSON.stringify({ stockId: stock.id, side: 'buy', quantity: 1, idempotencyKey: `live-${Date.now()}-a` }),
  });
  check('a buy executes', buy.status === 200, buy.body);
  if (buy.status === 200) {
    check(
      'cash falls by exactly price x quantity',
      buy.body.state.me === undefined || buy.body.state.me.cash === cashBefore - buy.body.receipt.amount,
      { cashBefore, after: buy.body.state.me?.cash, amount: buy.body.receipt.amount },
    );

    const key = `live-${Date.now()}-replay`;
    const once = await players[0].session.call<{ state: PlayState }>('/api/play/trade', {
      method: 'POST',
      body: JSON.stringify({ stockId: stock.id, side: 'buy', quantity: 1, idempotencyKey: key }),
    });
    const twice = await players[0].session.call<{ state: PlayState }>('/api/play/trade', {
      method: 'POST',
      body: JSON.stringify({ stockId: stock.id, side: 'buy', quantity: 1, idempotencyKey: key }),
    });
    check(
      'a repeated submission does not trade twice',
      once.body.state.me!.cash === twice.body.state.me!.cash,
      { first: once.body.state.me?.cash, second: twice.body.state.me?.cash },
    );
  }

  const overspend = await players[0].session.call('/api/play/trade', {
    method: 'POST',
    body: JSON.stringify({ stockId: stock.id, side: 'buy', quantity: 999999, idempotencyKey: `live-${Date.now()}-over` }),
  });
  check('spending more than you have is refused', overspend.status === 422, overspend.body);

  const oversell = await players[1].session.call('/api/play/trade', {
    method: 'POST',
    body: JSON.stringify({ stockId: stock.id, side: 'sell', quantity: 500, idempotencyKey: `live-${Date.now()}-sell` }),
  });
  check('selling shares you do not hold is refused', oversell.status === 422, oversell.body);

  /* ---------------- intelligence and secrets ---------------- */
  console.log('\nIntelligence and secrets');
  const latest = (await players[0].session.call<PlayState>('/api/play/state')).body;

  if (latest.intel.mode !== 'disabled' && (latest.me?.pieces ?? 0) > 0) {
    const intel = await players[0].session.call<{ receipt: { text: string } }>('/api/play/intel', {
      method: 'POST',
      body: JSON.stringify({ stockId: stock.id }),
    });
    check('intelligence can be bought', intel.status === 200, intel.body);
    check('it returns a real rule fragment', (intel.body.receipt?.text?.length ?? 0) > 20);
  } else {
    console.log('       intelligence not available in this session; skipped');
  }

  if (latest.secrets.enabled && (latest.me?.secretTokens ?? 0) > 0) {
    const secret = await players[1].session.call<{ receipt: { firstRound: number; lastRound: number } }>(
      '/api/play/secret',
      { method: 'POST', body: JSON.stringify({ stockId: stock.id }) },
    );
    check('a secret can be imposed', secret.status === 200, secret.body);
    if (secret.status === 200) {
      check(
        'it covers the rounds after the one it was used in',
        secret.body.receipt.firstRound > latest.game.round,
        secret.body.receipt,
      );
    }
  } else {
    console.log('       secrets not available in this session; skipped');
  }

  /* ---------------- display board ---------------- */
  console.log('\nDisplay board');
  const noToken = await fetch(`${BASE}/api/display/${state.game.id}/state`);
  check('the display board refuses a missing token', noToken.status === 403);
  const badToken = await fetch(`${BASE}/api/display/${state.game.id}/state?token=not-a-real-token`);
  check('the display board refuses a wrong token', badToken.status === 403);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) console.log(`failures: ${failures.join(', ')}`);
  console.log('\nThe two "ZZ Live Check" participants can be ignored, or use a throwaway session.\n');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\nlive check threw:', e);
  process.exit(1);
});

// This file is a standalone script; the export marks it as a module so its
// top-level names do not collide with the other test scripts.
export {};
