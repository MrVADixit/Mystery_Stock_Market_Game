'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { Chip, Sheet, Spinner } from '@/components/ui';
import { api } from '@/lib/client';
import { won } from '@/lib/format';
import type { TemplateSummary } from '@/server/game-templates';

export interface TemplateChoice {
  source: 'built-in' | 'custom' | 'blank';
  id?: string;
  stocks?: number;
}

interface TemplatesResponse {
  builtIn: TemplateSummary[];
  custom: TemplateSummary[];
}

export function useTemplates() {
  const [templates, setTemplates] = useState<TemplatesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    try {
      setTemplates(await api<TemplatesResponse>('/api/admin/templates'));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the templates.');
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  return { templates, error, reload };
}

/** One template as a selectable card. */
export function TemplateCard({
  template,
  selected,
  onSelect,
  footer,
}: {
  template: TemplateSummary;
  selected: boolean;
  onSelect: () => void;
  footer?: React.ReactNode;
}) {
  const [showMechanics, setShowMechanics] = useState(false);

  return (
    <div
      className={clsx(
        'rounded-xl border p-3.5 transition-colors',
        selected ? 'border-lavender bg-violet/12' : 'border-white/10 hover:border-lavender/40',
      )}
    >
      <button
        onClick={onSelect}
        className="w-full text-left"
        aria-pressed={selected}
        aria-label={`Choose ${template.name}`}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink">{template.name}</span>
              {template.source === 'custom' ? <Chip tone="up">Saved</Chip> : null}
              {template.isShared ? <Chip tone="neutral">Shared</Chip> : null}
            </div>
            <div className="text-[11px] uppercase tracking-wide text-lavender">{template.theme}</div>
          </div>
          <div className="tabular shrink-0 text-right text-[11px] text-muted">
            {template.stockCount} stocks
            <br />
            {template.defaultRounds} rounds
          </div>
        </div>

        <p className="mt-2 text-xs leading-relaxed text-muted">{template.description}</p>

        <div className="mt-2 flex flex-wrap gap-1">
          {template.stockNames.slice(0, 4).map((name) => (
            <span key={name} className="rounded bg-surface2/70 px-1.5 py-0.5 text-[10px] text-ink/80">
              {name}
            </span>
          ))}
          {template.stockNames.length > 4 ? (
            <span className="px-1 py-0.5 text-[10px] text-muted">
              +{template.stockNames.length - 4} more
            </span>
          ) : null}
        </div>
      </button>

      {template.designerNote ? (
        <p className="mt-2 border-l-2 border-lavender/40 pl-2 text-[11px] italic text-muted">
          {template.designerNote}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          className="text-[11px] font-semibold text-lavender hover:underline"
          onClick={() => setShowMechanics((v) => !v)}
        >
          {showMechanics ? 'Hide' : 'Show'} which mechanic each company runs
        </button>
        <span className="tabular text-[11px] text-muted">
          {won(template.startingCash)} won starting cash
        </span>
        {footer}
      </div>

      {showMechanics ? (
        <ul className="mt-2 space-y-0.5 rounded-lg bg-concrete/50 p-2">
          {template.mechanics.map((m) => (
            <li key={m.stockName} className="flex justify-between gap-3 text-[11px]">
              <span className="truncate text-ink">{m.stockName}</span>
              <span className="shrink-0 text-muted">{m.templateTitle}</span>
            </li>
          ))}
          <li className="pt-1 text-[10px] text-muted">
            This is for your eyes only — participants have to work it out.
          </li>
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The new-session flow: choose a template, adjust the length, and decide
 * whether to scramble it.
 */
export function NewSessionSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { templates, error: loadError } = useTemplates();

  const [choice, setChoice] = useState<TemplateChoice>({ source: 'built-in', id: 'classic' });
  const [name, setName] = useState('');
  const [rounds, setRounds] = useState<number | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [blankStocks, setBlankStocks] = useState(7);
  const [scramble, setScramble] = useState(true);
  const [seed, setSeed] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(() => {
    if (!templates || choice.source === 'blank') return null;
    const pool = choice.source === 'built-in' ? templates.builtIn : templates.custom;
    return pool.find((t) => t.id === choice.id) ?? null;
  }, [templates, choice]);

  // Default the length to whatever the chosen template was designed for.
  useEffect(() => {
    setRounds(null);
    setMinutes(null);
  }, [choice.source, choice.id]);

  const effectiveRounds = rounds ?? selected?.defaultRounds ?? 24;
  const effectiveMinutes = minutes ?? (selected?.defaultRoundSeconds ?? 300) / 60;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ gameId: string }>('/api/admin/games', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim() || selected?.name || 'Mystery Stock Market',
          template: choice.source === 'blank' ? { source: 'blank', stocks: blankStocks } : choice,
          rounds: effectiveRounds,
          roundSeconds: Math.max(5, Math.round(effectiveMinutes * 60)),
          scramble,
          ...(scramble && seed.trim() ? { seed: Number(seed.trim()) } : {}),
        }),
      });
      router.push(`/admin/${result.gameId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the session.');
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="New session" wide>
      {loadError ? <p className="mb-3 rounded-lg bg-down/15 px-3 py-2 text-sm text-down">{loadError}</p> : null}

      {!templates ? (
        <p className="text-sm text-muted">
          <Spinner className="mr-2" /> Loading templates…
        </p>
      ) : (
        <>
          <h4 className="label">Choose a game</h4>
          <div className="grid gap-2 sm:grid-cols-2">
            {templates.builtIn.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                selected={choice.source === 'built-in' && choice.id === template.id}
                onSelect={() => setChoice({ source: 'built-in', id: template.id })}
              />
            ))}
          </div>

          {templates.custom.length > 0 ? (
            <>
              <h4 className="label mt-5">Your saved templates</h4>
              <div className="grid gap-2 sm:grid-cols-2">
                {templates.custom.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    selected={choice.source === 'custom' && choice.id === template.id}
                    onSelect={() => setChoice({ source: 'custom', id: template.id })}
                  />
                ))}
              </div>
            </>
          ) : null}

          <h4 className="label mt-5">Or start from nothing</h4>
          <button
            onClick={() => setChoice({ source: 'blank' })}
            aria-pressed={choice.source === 'blank'}
            className={clsx(
              'w-full rounded-xl border p-3.5 text-left transition-colors',
              choice.source === 'blank'
                ? 'border-lavender bg-violet/12'
                : 'border-white/10 hover:border-lavender/40',
            )}
          >
            <div className="font-semibold text-ink">Build from scratch</div>
            <p className="mt-1 text-xs text-muted">
              Start with companies that do nothing and assign the mechanics yourself on the rule
              cards. You can save the result as your own template afterwards.
            </p>
          </button>
          {choice.source === 'blank' ? (
            <label className="mt-2 block">
              <span className="label">How many companies</span>
              <input
                type="number"
                min={1}
                max={40}
                className="field tabular w-28"
                value={blankStocks}
                onChange={(e) => setBlankStocks(Math.max(1, Math.min(40, Number(e.target.value) || 1)))}
              />
            </label>
          ) : null}

          {/* ---------------- settings ---------------- */}
          <div className="mt-6 border-t border-white/8 pt-4">
            <label className="block">
              <span className="label">Game name</span>
              <input
                className="field"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={selected?.name ?? 'Period 4 — Economics'}
                maxLength={120}
              />
            </label>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="label">Rounds</span>
                <input
                  type="number"
                  min={1}
                  max={200}
                  className="field tabular"
                  value={effectiveRounds}
                  onChange={(e) => setRounds(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
                />
              </label>
              <label className="block">
                <span className="label">Minutes per round</span>
                <input
                  type="number"
                  min={0.5}
                  max={60}
                  step={0.5}
                  className="field tabular"
                  value={effectiveMinutes}
                  onChange={(e) => setMinutes(Math.max(0.5, Math.min(60, Number(e.target.value) || 1)))}
                />
              </label>
            </div>
          </div>

          {/* ---------------- scramble ---------------- */}
          {choice.source !== 'blank' ? (
            <div
              className={clsx(
                'mt-4 rounded-xl border p-3.5',
                scramble ? 'border-lavender/40 bg-violet/10' : 'border-white/10',
              )}
            >
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={scramble}
                  onChange={(e) => setScramble(e.target.checked)}
                />
                <span>
                  <span className="block text-sm font-semibold text-ink">
                    Scramble the rules for this session
                  </span>
                  <span className="mt-1 block text-xs text-muted">
                    Re-assigns which company runs which mechanic, repoints every cross-reference and
                    varies all the numbers — including, sometimes, reversing whether buying pushes a
                    price up or down. A participant who has played this template before gets no head
                    start. Leave it on unless you specifically want the published version.
                  </span>
                </span>
              </label>

              {scramble ? (
                <label className="mt-3 block">
                  <span className="label">Seed (optional)</span>
                  <input
                    className="field tabular w-44"
                    value={seed}
                    onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="random"
                    inputMode="numeric"
                    maxLength={10}
                  />
                  <span className="mt-1 block text-xs text-muted">
                    Leave blank for a fresh puzzle. Reuse a seed to recreate an earlier session
                    exactly — useful for running the same game with two classes.
                  </span>
                </label>
              ) : null}
            </div>
          ) : null}

          {error ? <p className="mt-3 rounded-lg bg-down/15 px-3 py-2 text-sm text-down">{error}</p> : null}

          <button className="btn-primary mt-5 w-full" onClick={create} disabled={busy}>
            {busy ? <Spinner /> : null} Create session
          </button>
        </>
      )}
    </Sheet>
  );
}
