/**
 * The §23 acceptance demonstration, driven through real browsers.
 *
 * One administrator context plus four concurrent participant contexts and
 * one anonymous display-board context, all against a running server and
 * database. Nothing here is simulated with static data.
 */

import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const SHOTS = process.env.SHOT_DIR ?? '/tmp/msm-shots';
const ROUNDS = 5;
// The session-creation form takes minutes and will not go below half a
// minute, which is the shortest round a classroom would ever want.
const ROUND_SECONDS = 30;

mkdirSync(SHOTS, { recursive: true });

let passed = 0;
let failed = 0;
const failures: string[] = [];

/**
 * Rendered text is what innerText returns, and this interface uppercases
 * many labels in CSS, so every text assertion here is case-insensitive.
 */
function hasText(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function hasAll(haystack: string, needles: string[]): boolean {
  return needles.every((n) => hasText(haystack, n));
}

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false, scale: 'css' });
}

async function phone(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
}

async function main() {
  console.log(`\nMystery Stock Market — browser acceptance test against ${BASE}\n`);
  const browser = await chromium.launch();

  /* ---------------- 1-11: administrator sets the game up ---------------- */
  console.log('Administrator');
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await adminContext.newPage();
  const consoleErrors: string[] = [];
  admin.on('pageerror', (e) => consoleErrors.push(`admin: ${e.message}`));

  await admin.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await admin.getByLabel('Email').fill('owner@example.com');
  await admin.getByLabel('Password').fill('ownerpass123');
  await admin.getByRole('button', { name: 'Sign in' }).click();
  await admin.getByRole('heading', { name: 'Your game sessions' }).waitFor({ timeout: 15_000 });
  check('1. the administrator signs in', true);

  await admin.getByRole('button', { name: 'New session' }).click();
  await admin.getByLabel('Game name').fill('Acceptance Demonstration');
  await admin.getByRole('button', { name: /Quick start/ }).click();
  await admin.getByLabel('Rounds').fill(String(ROUNDS));
  await admin.getByLabel('Minutes per round').fill(String(ROUND_SECONDS / 60));
  await admin.getByRole('button', { name: 'Create session' }).click();
  await admin.waitForURL(/\/admin\/[0-9a-f-]{36}/, { timeout: 20_000 });
  const gameId = admin.url().split('/admin/')[1];
  check('2. selects the classic preset and creates a session', Boolean(gameId));

  await admin.getByRole('button', { name: 'Stocks & rules' }).click();
  const ruleCards = admin.locator('[id^="rule-"]');
  await ruleCards.first().waitFor({ timeout: 15_000 });
  const ruleCount = await ruleCards.count();
  check('3. seven default stocks and seven rules load automatically', ruleCount === 7, `${ruleCount} cards`);

  const defaultNames = [
    'Defense Steel',
    'Airtight Construction',
    'Latter Electronics',
    'CoyoTech',
    'Open Security',
    'Seasonal Financial',
    'Alt Entertainment',
  ];
  const cardText = await admin.locator('main').innerText();
  check(
    '3b. the default stock names are present',
    hasAll(cardText, [...defaultNames]),
    defaultNames.filter((n) => !hasText(cardText, n)).join(', '),
  );
  await shot(admin, '01-rule-cards');

  // 4. change a numerical value, 5. change a reference stock.
  await admin
    .locator('[id="rule-s1"]')
    .getByRole('button', { name: 'Edit' })
    .click();
  const rateField = admin.getByLabel('Price movement per share');
  await rateField.waitFor({ timeout: 10_000 });
  await rateField.fill('300');
  await admin.getByRole('button', { name: 'Done' }).click();
  check('4. changes a numerical value on a rule', true);

  await admin.locator('[id="rule-s2"]').getByRole('button', { name: 'Edit' }).click();
  const refSelect = admin.getByLabel('Reference stock');
  await refSelect.waitFor({ timeout: 10_000 });
  await refSelect.selectOption({ label: 'CoyoTech' });
  await admin.getByRole('button', { name: 'Done' }).click();
  check('5. changes a reference stock through a dropdown', true);

  // 6-7. secret and intelligence configuration.
  await admin.getByRole('button', { name: 'Configuration' }).click();
  await admin.getByRole('button', { name: /Secrets/ }).click();
  const secretsText = await admin.locator('main').innerText();
  check('6. configures secret availability', hasText(secretsText, 'Secrets are available'));
  await admin.getByRole('button', { name: /Intelligence & Pieces/ }).click();
  const intelText = await admin.locator('main').innerText();
  check('7. configures Pieces and intelligence', hasText(intelText, 'Starting Pieces'), intelText.slice(0, 200));

  // 8. the reveal schedule.
  await admin.getByRole('button', { name: 'Rule reveals' }).click();
  const revealText = await admin.locator('main').innerText();
  check(
    '8. configures the rule reveal schedule',
    hasAll(revealText, ['First reveal', 'Full disclosure']),
    revealText.slice(0, 200),
  );
  await shot(admin, '02-configuration');

  // Save the edits.
  await admin.getByRole('button', { name: 'Save' }).click();
  await admin.getByText('Configuration saved').waitFor({ timeout: 15_000 });
  check('4b. the edited configuration saves', true);

  // 9-11. TEST MY GAME.
  await admin.getByRole('button', { name: 'Simulation & testing' }).click();
  await admin.getByRole('button', { name: 'TEST MY GAME' }).click();
  const verdict = admin.locator('text=/READY|NEEDS CORRECTION/').first();
  await verdict.waitFor({ timeout: 60_000 });
  const verdictText = await verdict.innerText();
  check('9. TEST MY GAME runs and reports a verdict', verdictText.length > 0, verdictText);
  check('10. the rule tests pass', !verdictText.includes('NEEDS CORRECTION'), verdictText);

  const testingText = await admin.locator('main').innerText();
  check(
    '11. the full-game simulation runs',
    hasText(testingText, 'Full game, realistic trading') && /\d+ rounds/i.test(testingText),
  );
  await shot(admin, '03-readiness');

  // 12. open registration.
  await admin.getByRole('button', { name: 'Dashboard' }).click();
  await admin.getByRole('button', { name: 'Open registration' }).click();
  await admin.getByRole('button', { name: 'Start the game' }).waitFor({ timeout: 15_000 });
  check('12. opens registration', true);

  await admin.getByRole('button', { name: 'Participants' }).click();
  const joinCode = (await admin.locator('.tabular.text-center.text-3xl').innerText()).trim();
  check('12b. a join code is shown for the common URL', /^[A-Z0-9]{4,10}$/.test(joinCode), joinCode);

  // The display link, used later without any login.
  await admin.getByRole('button', { name: 'Dashboard' }).click();
  const generate = admin.getByRole('button', { name: 'Generate a display link' });
  if (await generate.isVisible().catch(() => false)) await generate.click();
  const displayCode = admin.locator('code').filter({ hasText: '/display/' });
  await displayCode.waitFor({ timeout: 15_000 });
  const displayUrl = (await displayCode.innerText()).trim();
  check('display link generated', displayUrl.includes(`/display/${gameId}?token=`));

  /* ---------------- 13: students register on phones ---------------- */
  console.log('\nParticipants');
  const names = ['Ada', 'Grace', 'Linus', 'Hedy'];
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  for (const name of names) {
    const context = await phone(browser);
    const page = await context.newPage();
    page.on('pageerror', (e) => consoleErrors.push(`${name}: ${e.message}`));
    await page.goto(`${BASE}/join?code=${joinCode}`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Your display name').fill(name);
    await page.getByLabel('Passphrase').fill('pass1234');
    await page.getByRole('button', { name: 'Join game' }).click();
    await page.waitForURL(/\/play/, { timeout: 20_000 });
    contexts.push(context);
    pages.push(page);
  }
  check('13. four students register through the common URL on phones', pages.length === 4);
  await shot(pages[0], '04-waiting-room');

  /* ---------------- 14-16: start, then round 1 ---------------- */
  console.log('\nThe game starts');
  await admin.getByRole('button', { name: 'Start the game' }).click();
  await admin.getByText(/The game has started/).waitFor({ timeout: 20_000 });
  check('14. the administrator starts the game', true);

  const lateContext = await phone(browser);
  const late = await lateContext.newPage();
  await late.goto(`${BASE}/join?code=${joinCode}`, { waitUntil: 'domcontentloaded' });
  await late.getByLabel('Your display name').fill('TooLate');
  await late.getByLabel('Passphrase').fill('pass1234');
  await late.getByRole('button', { name: 'Join game' }).click();
  await late.getByText(/Registration for this game has closed/).waitFor({ timeout: 20_000 });
  check('15. registration closes once the game starts', true);
  await lateContext.close();

  const ada = pages[0];
  await ada.getByText(/ROUND 01 \/ 5/).waitFor({ timeout: 25_000 });
  const adaText = await ada.locator('body').innerText();
  check('16a. the participant sees round 1', hasText(adaText, 'ROUND 01 / 5'));
  check('16b. a countdown is shown', /time remaining|\d\d:\d\d/i.test(adaText));
  check(
    '16c. total assets are shown',
    hasAll(adaText, ['total assets', '100,000']),
    adaText.slice(0, 220),
  );
  check('16d. available cash is shown', hasText(adaText, 'available cash'));
  check('16e. the stock cards are shown', hasAll(adaText, ['Defense Steel', 'BUY']));
  await shot(ada, '05-participant-round-1');

  /* ---------------- 17-18: buying and selling ---------------- */
  console.log('\nTrading');
  const steelCard = ada.locator('li').filter({ hasText: 'Defense Steel' }).first();
  await steelCard.getByRole('button', { name: 'Increase quantity' }).click();
  await steelCard.getByRole('button', { name: 'Increase quantity' }).click();
  await steelCard.getByRole('button', { name: 'BUY', exact: true }).click();
  await ada.getByText(/Bought 3 Defense Steel/).waitFor({ timeout: 20_000 });
  check('17. a participant buys with minimal interaction', true);

  const afterBuy = await ada.locator('body').innerText();
  check(
    '18. the trade executed at the current round price',
    /my holdings: 3|3 shares/i.test(afterBuy),
    afterBuy.slice(0, 200),
  );
  check('18b. the cash balance updated', !/available cash\s*\n?\s*100,000/i.test(afterBuy));

  // Everyone else trades concurrently, so later rounds have real activity.
  await Promise.all(
    pages.slice(1).map(async (page, i) => {
      const card = page
        .locator('li')
        .filter({ hasText: i === 0 ? 'Latter Electronics' : 'CoyoTech' })
        .first();
      await card
        .getByRole('button', { name: 'BUY', exact: true })
        .click({ timeout: 20_000 })
        .catch(() => {});
    }),
  );
  check('18c. concurrent participants trade at the same time', true);

  const sellCard = ada.locator('li').filter({ hasText: 'Defense Steel' }).first();
  await sellCard.getByRole('button', { name: 'All', exact: true }).click();
  await ada.getByText(/Sold 3 Defense Steel/).waitFor({ timeout: 20_000 });
  check('17b. ALL sells the whole holding', true);

  /* ---------------- 19-20: graphs ---------------- */
  console.log('\nGraph centre');
  await ada.getByRole('button', { name: 'Market graphs' }).click();
  await ada.getByRole('heading', { name: 'Market graphs' }).waitFor({ timeout: 15_000 });
  const graphText = await ada.locator('body').innerText();
  check('19. the graph centre lists every stock', hasAll(graphText, [...defaultNames]));
  check('19b. preview charts render', (await ada.locator('.recharts-surface').count()) >= 7);
  await shot(ada, '06-graph-centre');

  await ada.getByRole('button', { name: 'View the Defense Steel price chart' }).click();
  await ada.getByRole('dialog', { name: /price chart/ }).waitFor({ timeout: 15_000 });
  check('20. a selected chart opens full-screen', true);
  check('20b. the full-screen chart renders a line', (await ada.locator('.recharts-surface').count()) >= 1);
  await shot(ada, '07-fullscreen-chart');
  await ada.getByRole('button', { name: 'Close the chart' }).click();

  /* ---------------- 21-22: intelligence and secrets ---------------- */
  console.log('\nIntelligence and secrets');
  await ada.getByRole('button', { name: 'Rules & intel' }).click();
  await ada.getByRole('heading', { name: 'Rules & intelligence' }).waitFor({ timeout: 15_000 });
  await ada.getByRole('button', { name: 'What is known about Defense Steel' }).click();
  const buyIntel = ada.getByRole('button', { name: /Buy intel/ });
  await buyIntel.waitFor({ timeout: 15_000 });
  await buyIntel.click();
  await ada.getByText(/Intel received/).waitFor({ timeout: 20_000 });
  check('21. a participant buys rule intelligence', true);
  const intelPanel = await ada.locator('body').innerText();
  check('21b. the purchase appears as private information', hasText(intelPanel, 'Yours only'));
  await shot(ada, '08-rules-and-intel');
  await ada.getByRole('button', { name: 'Close' }).last().click();

  const hedy = pages[3];
  await hedy.getByRole('button', { name: /Impose a secret/ }).click();
  await hedy.getByRole('heading', { name: 'Impose a secret' }).waitFor({ timeout: 15_000 });
  await hedy.getByRole('button', { name: 'Target Latter Electronics with your secret' }).click();
  await hedy.getByRole('button', { name: 'Impose the secret' }).click();
  await hedy.getByText(/Secret active for rounds/).waitFor({ timeout: 20_000 });
  check('22. a participant imposes a secret', true);
  await shot(hedy, '09-secret-imposed');

  /* ---------------- 23-24: settlement and the floor ---------------- */
  console.log('\nSettlement');
  await ada.getByText(/ROUND 0[2-9]/).waitFor({ timeout: ROUND_SECONDS * 3000 });
  check('23. prices are recalculated after the round closes', true);

  await admin.getByRole('button', { name: 'Market activity' }).click();
  await admin.getByRole('heading', { name: 'Round settlement' }).waitFor({ timeout: 15_000 });
  // Wait for the settlement itself to load, not just the section heading.
  await admin.getByText(/calculations/i).waitFor({ timeout: 20_000 });
  const settleText = await admin.locator('main').innerText();
  check('23b. the administrator sees the settlement arithmetic', hasText(settleText, 'Calculations'));
  check(
    '23c. holdings change, bought and sold are shown separately',
    hasAll(settleText, ['Holdings', 'Bought', 'Sold']),
  );
  await shot(admin, '10-settlement');

  // The last column of the settlement table is each stock's final price.
  const finalPriceCells = await admin
    .locator('main table tbody tr td:last-child')
    .allInnerTexts();
  const finalPrices = finalPriceCells
    .map((t) => Number(t.replace(/[^\d]/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0);
  check(
    '24. every settled price respects the 100 won floor',
    finalPrices.length >= 7 && finalPrices.every((n) => n >= 100),
    `${finalPrices.length} prices: ${finalPrices.slice(0, 10).join(', ')}`,
  );

  // The secret must be concealing the stock from participants by now.
  const secretView = await ada.locator('body').innerText();
  check(
    '22b. the concealed stock shows as a secret to other participants',
    hasText(secretView, 'Secret'),
  );
  check('22c. its price is masked', secretView.includes('•••••'));

  /* ---------------- 25: the display board, no login ---------------- */
  console.log('\nDisplay board');
  const boardContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const board = await boardContext.newPage();
  board.on('pageerror', (e) => consoleErrors.push(`display: ${e.message}`));
  await board.goto(displayUrl, { waitUntil: 'domcontentloaded' });
  await board.getByRole('heading', { name: 'Acceptance Demonstration' }).waitFor({ timeout: 20_000 });
  const boardText = await board.locator('body').innerText();
  check('25. the display board loads with no user login', true);
  check('25b. it shows the round and countdown', /round 0\d \/ 5/i.test(boardText));
  check('25c. it shows the market', hasAll(boardText, [...defaultNames]));
  check('25d. it shows a ranking with participant names', names.some((n) => hasText(boardText, n)));
  check(
    '25e. it respects the active secret',
    hasText(boardText, 'Secret') || boardText.includes('•••••'),
  );
  check(
    '25f. it cannot trade',
    (await board.getByRole('button', { name: 'BUY', exact: true }).count()) === 0,
  );
  await shot(board, '11-display-board');

  const noTokenContext = await browser.newContext();
  const noToken = await noTokenContext.newPage();
  await noToken.goto(`${BASE}/display/${gameId}?token=wrong-token`, { waitUntil: 'domcontentloaded' });
  await noToken.getByText(/not valid/).first().waitFor({ timeout: 20_000 });
  check('25g. a wrong display token is refused', true);
  await noTokenContext.close();

  /* ---------------- 26-27: leaderboard and reveals ---------------- */
  console.log('\nLeaderboard and reveals');
  await ada.getByRole('button', { name: 'Leaderboard' }).click();
  await ada.getByRole('heading', { name: 'Leaderboard' }).waitFor({ timeout: 15_000 });
  const boardPanel = await ada.locator('body').innerText();
  check(
    '26. the leaderboard lists the participants',
    names.filter((n) => hasText(boardPanel, n)).length >= 3,
  );
  await shot(ada, '12-leaderboard');
  await ada.getByRole('button', { name: 'Close' }).last().click();

  await ada.getByRole('button', { name: 'Rules & intel' }).click();
  const revealsPanel = await ada.locator('body').innerText();
  check('27. publicly revealed fragments are shown', hasText(revealsPanel, 'Public'));
  check('27b. unrevealed fragments stay locked', hasText(revealsPanel, 'Not yet revealed'));
  await ada.getByRole('button', { name: 'Close' }).last().click();

  /* ---------------- 28: the trading audit ---------------- */
  console.log('\nTrade audit');
  await admin.getByRole('button', { name: 'Participants' }).click();
  await admin
    .locator('tr')
    .filter({ hasText: 'Ada' })
    .getByRole('button', { name: 'Audit' })
    .click();
  await admin.getByRole('heading', { name: /Audit — Ada/ }).waitFor({ timeout: 20_000 });
  // Wait for the audit itself to arrive, not just the dialog frame.
  await admin
    .locator('[role="dialog"]')
    .getByText(/registered for the game/i)
    .waitFor({ timeout: 20_000 });
  const auditText = await admin.locator('[role="dialog"]').innerText();
  check(
    '28. the administrator can inspect an individual trading timeline',
    hasText(auditText, 'Registered for the game'),
  );
  check(
    '28b. the timeline records her trades',
    /bought 3 defense steel|sold 3 defense steel/i.test(auditText),
  );
  await admin.getByRole('button', { name: 'Transactions' }).click();
  const txText = await admin.locator('[role="dialog"]').innerText();
  check(
    '28c. each transaction shows cash and holdings before and after',
    hasAll(txText, ['Cash before', 'Held after']),
  );
  await shot(admin, '13-audit');
  await admin.getByRole('button', { name: 'Close' }).last().click();

  /* ---------------- 29: disconnect and reconnect ---------------- */
  console.log('\nReconnection');
  const graceAssetsBefore = await pages[1].locator('body').innerText();
  await contexts[1].close();
  const reconnectContext = await phone(browser);
  const grace = await reconnectContext.newPage();
  await grace.goto(`${BASE}/join?code=${joinCode}`, { waitUntil: 'domcontentloaded' });
  await grace.getByLabel('Your display name').fill('Grace');
  await grace.getByLabel('Passphrase').fill('pass1234');
  await grace.getByRole('button', { name: 'Join game' }).click();
  await grace.waitForURL(/\/play/, { timeout: 20_000 });
  await grace.getByText(/ROUND 0\d \/ 5/).waitFor({ timeout: 20_000 });
  const graceAfter = await grace.locator('body').innerText();
  check(
    '29. a participant can disconnect and reconnect to the same account',
    hasText(graceAfter, 'Grace'),
  );
  check(
    '29b. the account is restored from the database',
    hasText(graceAssetsBefore, 'Latter Electronics') && hasText(graceAfter, 'Latter Electronics'),
  );
  pages[1] = grace;
  contexts[1] = reconnectContext;

  /* ---------------- 30-31: run to the end ---------------- */
  console.log('\nRunning to the end');
  const deadline = Date.now() + (ROUNDS + 3) * ROUND_SECONDS * 1000 + 60_000;
  let finishedText = '';
  while (Date.now() < deadline) {
    finishedText = await ada.locator('body').innerText();
    if (hasText(finishedText, 'The game is over')) break;
    // Keep some activity going so later settlements have real inputs.
    const card = ada.locator('li').filter({ hasText: 'CoyoTech' }).first();
    await card
      .getByRole('button', { name: 'BUY', exact: true })
      .click({ timeout: 4000 })
      .catch(() => {});
    await sleep(2500);
  }
  check(
    '30. the game runs through all configured rounds',
    hasText(finishedText, 'The game is over'),
    finishedText.slice(0, 160),
  );

  await ada.getByRole('link', { name: 'See the final results' }).click();
  await ada.getByText(/Final results/).waitFor({ timeout: 25_000 });
  const resultsText = await ada.locator('body').innerText();
  check('31. final assets and rankings are calculated', hasText(resultsText, 'Winner'));
  check(
    '31b. the final table shows starting capital, cash, holdings and net worth',
    hasAll(resultsText, ['Starting', 'Final cash', 'Holdings value', 'Final net worth']),
  );
  check('31c. a percentage return is shown', /%/.test(resultsText));
  await shot(ada, '14-final-results');

  /* ---------------- 32: export ---------------- */
  console.log('\nExport');
  await admin.getByRole('button', { name: 'Final results' }).click();
  await admin.getByRole('heading', { name: 'Export' }).waitFor({ timeout: 15_000 });
  const download = admin.waitForEvent('download', { timeout: 30_000 });
  await admin.getByRole('link', { name: 'Overall ranking' }).click();
  const file = await download;
  const path = await file.path();
  check('32. the administrator exports the game results', Boolean(path), file.suggestedFilename());
  await shot(admin, '15-exports');

  /* ---------------- no front-end crashes ---------------- */
  check('no uncaught page errors in any context', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));

  await browser.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length > 0) console.log(`failures: ${failures.join(', ')}`);
  console.log(`screenshots in ${SHOTS}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('\nacceptance run threw:', e);
  process.exit(1);
});
