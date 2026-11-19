'use client';

import clsx from 'clsx';
import { Card, Chip, SectionTitle, Spinner } from '@/components/ui';
import { signed, won } from '@/lib/format';
import type { ReadinessReport } from '@/lib/admin-types';

const VERDICTS: Record<string, { label: string; tone: string; tile: string }> = {
  READY: { label: 'READY', tone: 'text-up', tile: 'bg-up/15 ring-up/35' },
  READY_WITH_WARNINGS: {
    label: 'READY WITH WARNINGS',
    tone: 'text-amber-300',
    tile: 'bg-amber-400/12 ring-amber-400/35',
  },
  NEEDS_CORRECTION: { label: 'NEEDS CORRECTION', tone: 'text-down', tile: 'bg-down/15 ring-down/35' },
};

/** TEST MY GAME (§6.4). */
export function Readiness({
  report,
  busy,
  onRun,
  onJumpToRule,
  onAcknowledge,
  warningsAcknowledged,
}: {
  report: ReadinessReport | null;
  busy: boolean;
  onRun: () => void;
  onJumpToRule: (stockId: string) => void;
  onAcknowledge: () => void;
  warningsAcknowledged: boolean;
}) {
  const verdict = report ? VERDICTS[report.verdict] : null;
  const needsAck = report?.issues.some((i) => i.level === 'warning' && i.requiresAcknowledgement) ?? false;

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle hint="Validation, a probe of every rule, and a real simulation">
          Session readiness
        </SectionTitle>
        <p className="text-sm text-muted">
          This runs the configuration validator, then probes every assigned rule against figures worked
          out independently of the engine, then actually simulates the whole game with your stocks,
          rules and settings. A game is never reported ready just because its configuration parses.
        </p>
        <button className="btn-primary mt-4 w-full sm:w-auto" onClick={onRun} disabled={busy}>
          {busy ? <Spinner /> : null} TEST MY GAME
        </button>
      </Card>

      {report && verdict ? (
        <>
          <div className={clsx('rounded-xl p-5 ring-1 ring-inset', verdict.tile)}>
            <div className={clsx('text-2xl font-bold tracking-tight', verdict.tone)}>{verdict.label}</div>
            <p className="mt-1 text-sm text-ink/90">{report.summary}</p>
            <div className="tabular mt-3 flex flex-wrap gap-4 text-sm">
              <span className="text-up">{report.testsPassed} passed</span>
              {report.testsFailed > 0 ? <span className="text-down">{report.testsFailed} failed</span> : null}
              {report.warningCount > 0 ? (
                <span className="text-amber-300">{report.warningCount} warnings</span>
              ) : null}
              {report.errorCount > 0 ? (
                <span className="text-down">{report.errorCount} invalid settings</span>
              ) : null}
            </div>

            {needsAck && !warningsAcknowledged ? (
              <div className="mt-4 rounded-lg bg-concrete/50 p-3">
                <p className="text-sm text-ink">
                  Some of these settings are unusually large. Have a look at the simulated effect below,
                  then acknowledge that you meant them.
                </p>
                <button className="btn-secondary mt-2" onClick={onAcknowledge}>
                  I have read the warnings and meant these values
                </button>
              </div>
            ) : null}
          </div>

          {report.issues.length > 0 ? (
            <Card>
              <SectionTitle>Findings</SectionTitle>
              <ul className="space-y-2">
                {report.issues.map((issue, i) => (
                  <li
                    key={i}
                    className={clsx(
                      'rounded-lg p-3 text-sm',
                      issue.level === 'error' ? 'bg-down/12' : 'bg-amber-400/10',
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip tone={issue.level === 'error' ? 'down' : 'warn'}>
                        {issue.level === 'error' ? 'Must fix' : 'Warning'}
                      </Chip>
                      <span className="text-[11px] uppercase tracking-wide text-muted">
                        {issue.section}
                      </span>
                      {issue.stockId ? (
                        <button
                          className="ml-auto text-[11px] font-semibold text-lavender hover:underline"
                          onClick={() => onJumpToRule(issue.stockId!)}
                        >
                          Go to the rule card →
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-1 text-ink/90">{issue.message}</p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card>
            <SectionTitle hint={`${report.probes.filter((p) => p.passed).length}/${report.probes.length} passed`}>
              Rule probes
            </SectionTitle>
            <div className="scroll-x">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                    <th className="pb-2">Stock</th>
                    <th className="pb-2">Check</th>
                    <th className="pb-2 text-right">Expected</th>
                    <th className="pb-2 text-right">Actual</th>
                    <th className="pb-2 text-center">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {report.probes.map((probe, i) => (
                    <tr key={i}>
                      <td className="py-1.5 pr-2 text-ink">{probe.stockName}</td>
                      <td className="py-1.5 pr-2 text-muted">{probe.check}</td>
                      <td className="tabular py-1.5 text-right text-muted">{won(probe.expected)}</td>
                      <td className="tabular py-1.5 text-right text-ink">{won(probe.actual)}</td>
                      <td className="py-1.5 text-center">
                        {probe.passed ? <Chip tone="up">pass</Chip> : <Chip tone="down">fail</Chip>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <SectionTitle hint="Every scenario runs the real engine">Simulated scenarios</SectionTitle>
            <ul className="space-y-1.5">
              {report.scenarios.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 border-b border-white/5 pb-1.5 text-sm">
                  {s.passed ? <Chip tone="up">pass</Chip> : <Chip tone="down">fail</Chip>}
                  <span className="min-w-0 flex-1 text-ink">{s.name}</span>
                  <span className="tabular text-xs text-muted">
                    {s.roundsRun} rounds
                    {s.floorEvents > 0 ? ` · ${s.floorEvents} floor hits` : ''}
                    {s.extremeMoves > 0 ? ` · ${s.extremeMoves} extreme moves` : ''}
                  </span>
                  {s.error ? <span className="w-full text-xs text-down">{s.error}</span> : null}
                </li>
              ))}
            </ul>
          </Card>

          {report.expectedFloorEvents.length > 0 || report.extremeMoves.length > 0 ? (
            <Card>
              <SectionTitle hint="From the full-game simulation">What the game will actually do</SectionTitle>
              {report.expectedFloorEvents.length > 0 ? (
                <div className="mb-3">
                  <div className="label">Expected price-floor events</div>
                  <p className="tabular text-sm text-ink">
                    {report.expectedFloorEvents
                      .slice(0, 12)
                      .map((e) => `${e.stockName} in round ${e.round}`)
                      .join(' · ')}
                    {report.expectedFloorEvents.length > 12
                      ? ` … and ${report.expectedFloorEvents.length - 12} more`
                      : ''}
                  </p>
                </div>
              ) : null}
              {report.extremeMoves.length > 0 ? (
                <div>
                  <div className="label">Movements of 50% or more</div>
                  <p className="tabular text-sm text-ink">
                    {report.extremeMoves
                      .slice(0, 12)
                      .map((e) => `${e.stockName} R${e.round} ${signed(e.pct)}%`)
                      .join(' · ')}
                    {report.extremeMoves.length > 12 ? ` … and ${report.extremeMoves.length - 12} more` : ''}
                  </p>
                </div>
              ) : null}
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
