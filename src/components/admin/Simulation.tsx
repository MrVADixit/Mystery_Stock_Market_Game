'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Card, Chip, SectionTitle, Spinner } from '@/components/ui';
import { ComparisonChart } from '@/components/charts';
import { api } from '@/lib/client';
import { pct, signed, won } from '@/lib/format';
import type { ScenarioSummary } from '@/server/simulation';
import type { SessionConfig } from '@/engine/types';

interface ScenarioMeta {
  id: string;
  name: string;
  description: string;
  participants: number;
}

interface SimResponse {
  result: ScenarioSummary;
  standings: {
    scenario: { id: string; name: string };
    standings: { rank: number; participant: number; netWorth: number; gain: number; returnPct: number }[];
  } | null;
}

/**
 * The simulation section (§15).
 *
 * Seven predefined checks, a handful of adjustable quantities, and the
 * three strategic demonstrations. None of this touches the live session.
 */
export function Simulation({ gameId, config }: { gameId: string; config: SessionConfig }) {
  const [scenarios, setScenarios] = useState<ScenarioMeta[]>([]);
  const [quickTests, setQuickTests] = useState<string[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [response, setResponse] = useState<SimResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Adjustable quantities for the one-off check.
  const [stockId, setStockId] = useState(config.stocks[0]?.id ?? '');
  const [action, setAction] = useState<'buy' | 'sell' | 'holdings'>('buy');
  const [quantity, setQuantity] = useState(50);
  const [secretStockId, setSecretStockId] = useState('');
  const [secretRound, setSecretRound] = useState(2);

  useEffect(() => {
    api<{ scenarios: ScenarioMeta[]; quickTests: string[] }>(`/api/admin/games/${gameId}/scenarios`)
      .then((r) => {
        setScenarios(r.scenarios);
        setQuickTests(r.quickTests);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not list the scenarios.'));
  }, [gameId]);

  async function run(body: unknown, label: string) {
    setRunning(label);
    setError(null);
    try {
      setResponse(await api<SimResponse>(`/api/admin/games/${gameId}/simulate`, {
        method: 'POST',
        body: JSON.stringify(body),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The simulation failed.');
    } finally {
      setRunning(null);
    }
  }

  const quick = scenarios.filter((s) => quickTests.includes(s.id));
  const demos = scenarios.filter((s) => s.id.startsWith('demo-'));
  const others = scenarios.filter((s) => !quickTests.includes(s.id) && !s.id.startsWith('demo-'));

  const chartStocks = useMemo(() => {
    if (!response) return [];
    return config.stocks.map((s) => ({
      id: s.id,
      name: s.name,
      priceHistory: (response.result.priceHistory[s.id] ?? []) as (number | null)[],
    }));
  }, [response, config.stocks]);

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle hint="Never touches the live game">Quick checks</SectionTitle>
        <div className="grid gap-2 sm:grid-cols-2">
          {quick.map((s) => (
            <button
              key={s.id}
              className="rounded-lg border border-white/10 p-3 text-left transition-colors hover:border-lavender/40"
              disabled={running !== null}
              onClick={() => void run({ kind: 'scenario', scenarioId: s.id }, s.id)}
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                {running === s.id ? <Spinner /> : null}
                {s.name}
              </div>
              <p className="mt-0.5 text-xs text-muted">{s.description}</p>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <SectionTitle>One-off check</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="block">
            <span className="label">Stock</span>
            <select className="field" value={stockId} onChange={(e) => setStockId(e.target.value)}>
              {config.stocks.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">What happens</span>
            <select
              className="field"
              value={action}
              onChange={(e) => setAction(e.target.value as typeof action)}
            >
              <option value="buy">Participants buy</option>
              <option value="sell">Participants buy then sell</option>
              <option value="holdings">Hold total holdings at</option>
            </select>
          </label>
          <label className="block">
            <span className="label">Shares</span>
            <input
              type="number"
              className="field tabular"
              min={0}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(0, Math.round(Number(e.target.value) || 0)))}
            />
          </label>
          <div className="flex items-end">
            <button
              className="btn-primary w-full"
              disabled={running !== null}
              onClick={() =>
                void run(
                  {
                    kind: 'ad-hoc',
                    ...(action === 'buy' ? { buy: { stockId, quantity } } : {}),
                    ...(action === 'sell' ? { sell: { stockId, quantity } } : {}),
                    ...(action === 'holdings' ? { holdingsTarget: { stockId, quantity } } : {}),
                    ...(secretStockId ? { secret: { stockId: secretStockId, round: secretRound } } : {}),
                  },
                  'ad-hoc',
                )
              }
            >
              {running === 'ad-hoc' ? <Spinner /> : null} Run
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="label">Also impose a secret on</span>
            <select
              className="field"
              value={secretStockId}
              onChange={(e) => setSecretStockId(e.target.value)}
            >
              <option value="">No secret</option>
              {config.stocks.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">In round</span>
            <input
              type="number"
              className="field tabular"
              min={1}
              max={config.rounds}
              value={secretRound}
              disabled={!secretStockId}
              onChange={(e) => setSecretRound(Math.max(1, Math.round(Number(e.target.value) || 1)))}
            />
          </label>
        </div>
      </Card>

      <Card>
        <SectionTitle hint="Reconstructed from the actual rules, not from claimed figures">
          Strategic demonstrations
        </SectionTitle>
        <p className="mb-3 text-xs text-muted">
          Each demonstration replays a real trade sequence through the configured rules, cash limits,
          holdings limits, price floor and secret timing, and reports whatever genuinely comes out. No
          profit figure is assumed.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {demos.map((s) => (
            <button
              key={s.id}
              className="rounded-lg border border-white/10 p-3 text-left transition-colors hover:border-lavender/40"
              disabled={running !== null}
              onClick={() => void run({ kind: 'scenario', scenarioId: s.id, withStandings: true }, s.id)}
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                {running === s.id ? <Spinner /> : null}
                {s.name.replace('Demonstration: ', '')}
              </div>
              <p className="mt-0.5 text-xs text-muted">{s.description}</p>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <SectionTitle hint={`${others.length} scenarios`}>The full scenario pack</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {others.map((s) => (
            <button
              key={s.id}
              className="rounded-full border border-white/12 px-2.5 py-1 text-[11px] text-muted hover:border-lavender/40 hover:text-ink"
              disabled={running !== null}
              onClick={() => void run({ kind: 'scenario', scenarioId: s.id }, s.id)}
            >
              {s.name}
            </button>
          ))}
        </div>
      </Card>

      {error ? <p className="rounded-lg bg-down/15 px-3 py-2 text-sm text-down">{error}</p> : null}

      {response ? (
        <>
          <Card>
            <SectionTitle hint={`${response.result.roundsRun} rounds simulated`}>
              {response.result.name}
            </SectionTitle>
            <ComparisonChart stocks={chartStocks} height={300} />

            <div className="mt-3 flex flex-wrap gap-3 text-xs">
              {response.result.floorEvents.length > 0 ? (
                <Chip tone="warn">{response.result.floorEvents.length} floor events</Chip>
              ) : null}
              {response.result.extremeMoves.length > 0 ? (
                <Chip tone="warn">{response.result.extremeMoves.length} moves over 50%</Chip>
              ) : null}
              {response.result.rejected.length > 0 ? (
                <Chip tone="neutral">{response.result.rejected.length} orders rejected by cash or holdings limits</Chip>
              ) : null}
            </div>

            <div className="scroll-x mt-3">
              <table className="w-full min-w-[720px] text-xs">
                <thead>
                  <tr className="text-left uppercase tracking-wide text-muted">
                    <th className="pb-2">Round</th>
                    {config.stocks.map((s) => (
                      <th key={s.id} className="pb-2 text-right">
                        {s.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {response.result.rounds.map((r) => (
                    <tr key={r.round}>
                      <td className="tabular py-1 text-muted">{r.round}</td>
                      {config.stocks.map((s) => (
                        <td key={s.id} className="tabular py-1 text-right text-ink">
                          {won(r.prices[s.id])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {response.standings ? (
            <Card>
              <SectionTitle>Simulated standings</SectionTitle>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                    <th className="pb-2">Rank</th>
                    <th className="pb-2">Simulated participant</th>
                    <th className="pb-2 text-right">Net worth</th>
                    <th className="pb-2 text-right">Gain</th>
                    <th className="pb-2 text-right">Return</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {response.standings.standings.map((row) => (
                    <tr key={row.participant}>
                      <td className="tabular py-1.5 text-lavender">{row.rank}</td>
                      <td className="py-1.5 text-ink">Participant {row.participant + 1}</td>
                      <td className="tabular py-1.5 text-right text-ink">{won(row.netWorth)}</td>
                      <td
                        className={clsx(
                          'tabular py-1.5 text-right',
                          row.gain > 0 ? 'text-up' : row.gain < 0 ? 'text-down' : 'text-muted',
                        )}
                      >
                        {signed(row.gain)}
                      </td>
                      <td className="tabular py-1.5 text-right text-muted">{pct(row.returnPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : null}

          <Card>
            <SectionTitle>Rule explanations, round by round</SectionTitle>
            <div className="max-h-96 space-y-2 overflow-y-auto">
              {response.result.rounds.map((r) => (
                <details key={r.round} className="rounded-lg bg-surface2/40 p-2">
                  <summary className="cursor-pointer text-xs font-semibold text-lavender">
                    Round {r.round}
                  </summary>
                  <ul className="mt-1.5 space-y-1 text-[11px]">
                    {r.evaluations.map((e) => (
                      <li key={e.stockId} className="text-ink/85">
                        <span className="font-semibold text-ink">{e.stockName}:</span> {e.explanation}
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
