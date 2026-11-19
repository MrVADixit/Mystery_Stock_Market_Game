'use client';

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Card, Chip, Sheet, Spinner } from '@/components/ui';
import { api } from '@/lib/client';
import { pct, signed, won } from '@/lib/format';
import { TEMPLATE_ORDER, TEMPLATES, templateOf } from '@/engine/templates';
import { classicPreset } from '@/engine/preset';
import { fromBps, toBps } from '@/engine/money';
import { defaultDisclosures, disclosureLabel } from '@/engine/disclosure';
import { validateConfig } from '@/engine/validate';
import type { RuleParams, RuleTemplateId, SessionConfig, StockConfig } from '@/engine/types';
import type { PreviewResult } from '@/engine/preview';

/**
 * The rule editor (§5.2).
 *
 * Seven reusable cards. Each shows the stock it is assigned to, the rule
 * name, the formula in plain English, the editable numbers and the stock
 * selectors. There is no expression editor and no operator list anywhere.
 */
export function RuleCards({
  gameId,
  config,
  editable,
  onChange,
}: {
  gameId: string;
  config: SessionConfig;
  editable: boolean;
  onChange: (next: SessionConfig) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);

  const nameOf = (id: string) => config.stocks.find((s) => s.id === id)?.name ?? id;
  const issues = useMemo(() => validateConfig(config), [config]);

  return (
    <div className="space-y-3">
      {!editable ? (
        <p className="rounded-lg bg-surface2/60 p-3 text-sm text-muted">
          The game has started, so the rules are locked. You can still read every formula and run
          previews.
        </p>
      ) : null}

      {config.stocks.map((stock, index) => {
        const definition = templateOf(stock.rule);
        const stockIssues = issues.filter((i) => i.stockId === stock.id);
        const errorCount = stockIssues.filter((i) => i.level === 'error').length;
        const warnCount = stockIssues.filter((i) => i.level === 'warning').length;

        return (
          <Card key={stock.id} id={`rule-${stock.id}`}>
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-muted">
                    Rule {index + 1}
                  </span>
                  <h3 className="text-base font-semibold text-ink">{stock.name}</h3>
                  <Chip tone="violet">{definition.title}</Chip>
                  {errorCount > 0 ? <Chip tone="down">{errorCount} to fix</Chip> : null}
                  {errorCount === 0 && warnCount > 0 ? <Chip tone="warn">{warnCount} warning</Chip> : null}
                  {errorCount === 0 && warnCount === 0 ? <Chip tone="up">Checks pass</Chip> : null}
                </div>

                <p className="mt-2 text-sm leading-relaxed text-ink/90">
                  {definition.describe(stock.rule, {
                    stockName: stock.name,
                    nameOf,
                    minPrice: config.minPrice,
                  })}
                </p>

                <div className="tabular mt-2 text-xs text-muted">
                  Opening price {won(stock.initialPrice)} won · reveals at rounds{' '}
                  {config.disclosure.rounds.join(', ')}
                </div>

                {stockIssues.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {stockIssues.map((issue, i) => (
                      <li
                        key={i}
                        className={clsx(
                          'rounded-md px-2 py-1 text-xs',
                          issue.level === 'error' ? 'bg-down/15 text-down' : 'bg-amber-400/10 text-amber-300',
                        )}
                      >
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 border-t border-white/8 pt-3">
              <button className="btn-secondary px-3 py-2 text-xs" onClick={() => setEditing(stock.id)}>
                {editable ? 'Edit' : 'Inspect'}
              </button>
              <button className="btn-secondary px-3 py-2 text-xs" onClick={() => setPreviewing(stock.id)}>
                Preview
              </button>
              {editable ? (
                <>
                  <button
                    className="btn-ghost px-3 py-2 text-xs"
                    onClick={() => onChange(restoreDefault(config, stock.id))}
                  >
                    Restore default
                  </button>
                  <DuplicateMenu config={config} stock={stock} onChange={onChange} />
                </>
              ) : null}
            </div>
          </Card>
        );
      })}

      {editing ? (
        <RuleEditor
          config={config}
          stockId={editing}
          editable={editable}
          onClose={() => setEditing(null)}
          onChange={onChange}
        />
      ) : null}

      {previewing ? (
        <RulePreview
          gameId={gameId}
          config={config}
          stockId={previewing}
          onClose={() => setPreviewing(null)}
        />
      ) : null}
    </div>
  );
}

/** Puts one stock's rule back to what the classic preset ships. */
function restoreDefault(config: SessionConfig, stockId: string): SessionConfig {
  const preset = classicPreset({ rounds: config.rounds, minPrice: config.minPrice });
  const presetStock = preset.stocks.find((s) => s.id === stockId);
  if (!presetStock) return config;
  return {
    ...config,
    stocks: config.stocks.map((s) =>
      s.id === stockId ? { ...s, rule: presetStock.rule, disclosure: presetStock.disclosure } : s,
    ),
  };
}

function DuplicateMenu({
  config,
  stock,
  onChange,
}: {
  config: SessionConfig;
  stock: StockConfig;
  onChange: (next: SessionConfig) => void;
}) {
  const [open, setOpen] = useState(false);
  const others = config.stocks.filter((s) => s.id !== stock.id);

  return (
    <div className="relative">
      <button className="btn-ghost px-3 py-2 text-xs" onClick={() => setOpen((v) => !v)}>
        Duplicate to…
      </button>
      {open ? (
        <div className="absolute left-0 z-10 mt-1 w-56 rounded-lg border border-white/10 bg-surface2 p-1 shadow-lg">
          {others.map((target) => (
            <button
              key={target.id}
              className="block w-full rounded px-2 py-1.5 text-left text-xs text-ink hover:bg-white/8"
              onClick={() => {
                setOpen(false);
                // The same mechanic, reassigned. A self-reference is
                // repointed at the original stock so the copy stays legal.
                const copied = repointSelfReference(stock.rule, stock.id, target.id);
                const nameOf = (id: string) => config.stocks.find((s) => s.id === id)?.name ?? id;
                onChange({
                  ...config,
                  stocks: config.stocks.map((s) =>
                    s.id === target.id
                      ? {
                          ...s,
                          rule: copied,
                          disclosure: defaultDisclosures(copied, {
                            stockName: s.name,
                            nameOf,
                            minPrice: config.minPrice,
                          }),
                        }
                      : s,
                  ),
                });
              }}
            >
              {target.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function repointSelfReference(rule: RuleParams, fromId: string, toId: string): RuleParams {
  const copy = structuredClone(rule);
  if (copy.template === 'CROSS_STOCK_DIRECTION' && copy.referenceStockId === toId) {
    copy.referenceStockId = fromId;
  }
  if (copy.template === 'RELATIVE_BUY_VOLUME' && copy.comparisonStockId === toId) {
    copy.comparisonStockId = fromId;
  }
  if (copy.template === 'SECRET_DEPENDENT' && copy.referenceStockId === toId) {
    copy.referenceStockId = fromId;
  }
  return copy;
}

/* ---------------------------------------------------------------- */
/* Editor                                                            */
/* ---------------------------------------------------------------- */

function NumberField({
  label,
  value,
  onChange,
  hint,
  disabled,
  min,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  hint?: string;
  disabled?: boolean;
  min?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="number"
          className="field tabular"
          value={value}
          step={step}
          min={min}
          disabled={disabled}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }}
        />
        {suffix ? <span className="shrink-0 text-xs text-muted">{suffix}</span> : null}
      </span>
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

function StockSelect({
  label,
  value,
  onChange,
  config,
  exclude,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  config: SessionConfig;
  exclude?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <select
        className="field"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {config.stocks
          .filter((s) => s.id !== exclude)
          .map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
      </select>
    </label>
  );
}

function RuleEditor({
  config,
  stockId,
  editable,
  onClose,
  onChange,
}: {
  config: SessionConfig;
  stockId: string;
  editable: boolean;
  onClose: () => void;
  onChange: (next: SessionConfig) => void;
}) {
  const stock = config.stocks.find((s) => s.id === stockId);
  if (!stock) return null;
  const nameOf = (id: string) => config.stocks.find((s) => s.id === id)?.name ?? id;

  const update = (mutate: (draft: StockConfig) => void) => {
    const next = structuredClone(config);
    const draft = next.stocks.find((s) => s.id === stockId);
    if (!draft) return;
    mutate(draft);
    onChange(next);
  };

  const setRule = (rule: RuleParams) =>
    update((draft) => {
      draft.rule = rule;
      draft.disclosure = defaultDisclosures(rule, {
        stockName: draft.name,
        nameOf,
        minPrice: config.minPrice,
      });
    });

  const rule = stock.rule;

  return (
    <Sheet open onClose={onClose} title={`${stock.name} — ${templateOf(rule).title}`} wide>
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Stock name</span>
            <input
              className="field"
              value={stock.name}
              disabled={!editable}
              maxLength={60}
              onChange={(e) =>
                update((draft) => {
                  draft.name = e.target.value;
                })
              }
            />
          </label>
          <NumberField
            label="Opening price"
            value={stock.initialPrice}
            suffix="won"
            min={config.minPrice}
            disabled={!editable}
            onChange={(n) =>
              update((draft) => {
                draft.initialPrice = Math.round(n);
              })
            }
          />
        </div>

        <label className="block">
          <span className="label">Pricing mechanic</span>
          <select
            className="field"
            value={rule.template}
            disabled={!editable}
            onChange={(e) => setRule(blankRule(e.target.value as RuleTemplateId, config, stockId))}
          >
            {TEMPLATE_ORDER.map((id) => (
              <option key={id} value={id}>
                {TEMPLATES[id].title}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-muted">{TEMPLATES[rule.template].summary}</span>
        </label>

        {/* Template-specific numbers. The structure is never editable. */}
        {rule.template === 'HOLDINGS_DELTA' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField
              label="Price movement per share"
              value={rule.wonPerShare}
              suffix="won"
              min={0}
              disabled={!editable}
              hint="How far the price moves for each share of change in total market holdings."
              onChange={(n) => setRule({ ...rule, wonPerShare: Math.max(0, Math.round(n)) })}
            />
            <label className="block">
              <span className="label">Relationship</span>
              <select
                className="field"
                value={rule.inverted ? 'same' : 'inverse'}
                disabled={!editable}
                onChange={(e) => setRule({ ...rule, inverted: e.target.value === 'same' })}
              >
                <option value="inverse">More holdings → price falls (default)</option>
                <option value="same">More holdings → price rises</option>
              </select>
            </label>
            <NumberField
              label="Maximum holdings change counted per round"
              value={rule.maxHoldingsChangePerRound ?? 0}
              suffix="shares (0 = no cap)"
              min={0}
              disabled={!editable}
              onChange={(n) =>
                setRule({ ...rule, maxHoldingsChangePerRound: n < 1 ? null : Math.round(n) })
              }
            />
          </div>
        ) : null}

        {rule.template === 'CROSS_STOCK_DIRECTION' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <StockSelect
              label="Reference stock"
              value={rule.referenceStockId}
              exclude={stockId}
              config={config}
              disabled={!editable}
              onChange={(id) => setRule({ ...rule, referenceStockId: id })}
            />
            <NumberField
              label="If the reference rose"
              value={fromBps(rule.upBps)}
              suffix="%"
              step={0.1}
              disabled={!editable}
              onChange={(n) => setRule({ ...rule, upBps: toBps(Math.round(n * 100) / 100) })}
            />
            <NumberField
              label="Otherwise"
              value={fromBps(rule.downBps)}
              suffix="%"
              step={0.1}
              disabled={!editable}
              onChange={(n) => setRule({ ...rule, downBps: toBps(Math.round(n * 100) / 100) })}
            />
            <label className="block">
              <span className="label">An unchanged reference price counts as</span>
              <select
                className="field"
                value={rule.unchangedCountsAs}
                disabled={!editable}
                onChange={(e) =>
                  setRule({ ...rule, unchangedCountsAs: e.target.value as 'positive' | 'negative' })
                }
              >
                <option value="negative">The negative branch (default)</option>
                <option value="positive">The positive branch</option>
              </select>
            </label>
          </div>
        ) : null}

        {rule.template === 'HOLDINGS_SWEET_SPOT' ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField
                label="Lower boundary"
                value={rule.lower}
                suffix="shares"
                min={0}
                disabled={!editable}
                onChange={(n) => setRule({ ...rule, lower: Math.max(0, Math.round(n)) })}
              />
              <NumberField
                label="Upper boundary"
                value={rule.upper}
                suffix="shares"
                min={0}
                disabled={!editable}
                onChange={(n) => setRule({ ...rule, upper: Math.max(0, Math.round(n)) })}
              />
              <NumberField
                label="Inside the range"
                value={rule.insideWon}
                suffix="won"
                disabled={!editable}
                onChange={(n) => setRule({ ...rule, insideWon: Math.round(n) })}
              />
              <NumberField
                label="Outside the range"
                value={rule.outsideWon}
                suffix="won"
                disabled={!editable}
                onChange={(n) => setRule({ ...rule, outsideWon: Math.round(n) })}
              />
            </div>
            {/* The boundary behaviour, spelled out as §4 requires. */}
            <div className="rounded-lg bg-surface2/60 p-3">
              <div className="label mb-1">What happens at the boundaries</div>
              <ul className="tabular space-y-0.5 text-xs text-muted">
                {[rule.lower - 1, rule.lower, Math.floor((rule.lower + rule.upper) / 2), rule.upper, rule.upper + 1]
                  .filter((n) => n >= 0)
                  .map((held, i) => {
                    const inside = held >= rule.lower && held <= rule.upper;
                    return (
                      <li key={i}>
                        {held} holdings →{' '}
                        <span className={inside ? 'text-up' : 'text-down'}>
                          {signed(inside ? rule.insideWon : rule.outsideWon)} won
                        </span>{' '}
                        ({inside ? 'inside' : 'outside'})
                      </li>
                    );
                  })}
              </ul>
            </div>
          </>
        ) : null}

        {rule.template === 'RELATIVE_BUY_VOLUME' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <StockSelect
              label="Compared against"
              value={rule.comparisonStockId}
              exclude={stockId}
              config={config}
              disabled={!editable}
              onChange={(id) => setRule({ ...rule, comparisonStockId: id })}
            />
            <label className="block">
              <span className="label">Volume measured as</span>
              <select className="field" value="gross" disabled>
                <option value="gross">Gross purchases (sales are not subtracted)</option>
              </select>
              <span className="mt-1 block text-xs text-muted">
                This rule always uses gross buying volume, never net.
              </span>
            </label>
            <NumberField
              label="If this stock was bought more"
              value={rule.aboveWon}
              suffix="won"
              disabled={!editable}
              onChange={(n) => setRule({ ...rule, aboveWon: Math.round(n) })}
            />
            <NumberField
              label="Otherwise"
              value={rule.belowWon}
              suffix="won"
              disabled={!editable}
              onChange={(n) => setRule({ ...rule, belowWon: Math.round(n) })}
            />
            <label className="block">
              <span className="label">An exact tie counts as</span>
              <select
                className="field"
                value={rule.tieCountsAs}
                disabled={!editable}
                onChange={(e) => setRule({ ...rule, tieCountsAs: e.target.value as 'positive' | 'negative' })}
              >
                <option value="negative">The negative branch (default)</option>
                <option value="positive">The positive branch</option>
              </select>
            </label>
          </div>
        ) : null}

        {rule.template === 'SECRET_DEPENDENT' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <StockSelect
              label="Watched stock"
              value={rule.referenceStockId}
              config={config}
              disabled={!editable}
              onChange={(id) => setRule({ ...rule, referenceStockId: id })}
            />
            <NumberField
              label="While a secret is active"
              value={fromBps(rule.activeBps)}
              suffix="%"
              step={0.1}
              disabled={!editable}
              onChange={(n) => setRule({ ...rule, activeBps: toBps(Math.round(n * 100) / 100) })}
            />
            <NumberField
              label="While no secret is active"
              value={rule.inactiveWon}
              suffix="won"
              disabled={!editable}
              onChange={(n) => setRule({ ...rule, inactiveWon: Math.round(n) })}
            />
          </div>
        ) : null}

        {rule.template === 'MARKET_SENTIMENT' ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField
                label="Rising stocks needed"
                value={rule.risingThreshold}
                min={1}
                disabled={!editable}
                onChange={(n) => setRule({ ...rule, risingThreshold: Math.max(1, Math.round(n)) })}
              />
              <NumberField
                label="Falling stocks needed"
                value={rule.fallingThreshold}
                min={1}
                disabled={!editable}
                onChange={(n) => setRule({ ...rule, fallingThreshold: Math.max(1, Math.round(n)) })}
              />
              <NumberField
                label="On a broad rally"
                value={fromBps(rule.risingBps)}
                suffix="%"
                step={0.1}
                disabled={!editable}
                onChange={(n) => setRule({ ...rule, risingBps: toBps(Math.round(n * 100) / 100) })}
              />
              <NumberField
                label="On a broad sell-off"
                value={fromBps(rule.fallingBps)}
                suffix="%"
                step={0.1}
                disabled={!editable}
                onChange={(n) => setRule({ ...rule, fallingBps: toBps(Math.round(n * 100) / 100) })}
              />
            </div>
            <div>
              <span className="label">Stocks counted</span>
              <div className="flex flex-wrap gap-1.5">
                {config.stocks.map((s) => {
                  const on = rule.universe.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={!editable}
                      onClick={() =>
                        setRule({
                          ...rule,
                          universe: on
                            ? rule.universe.filter((id) => id !== s.id)
                            : [...rule.universe, s.id],
                        })
                      }
                      className={clsx(
                        'rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                        on ? 'border-lavender bg-violet/25 text-lavender' : 'border-white/15 text-muted',
                      )}
                      aria-pressed={on}
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
              <p
                className={clsx(
                  'mt-2 rounded-md px-2 py-1 text-xs',
                  rule.risingThreshold + rule.fallingThreshold <= rule.universe.length
                    ? 'bg-down/15 text-down'
                    : 'bg-surface2/60 text-muted',
                )}
              >
                {rule.risingThreshold + rule.fallingThreshold <= rule.universe.length
                  ? `These thresholds overlap: ${rule.risingThreshold} rising and ${rule.fallingThreshold} falling can both happen at once in a ${rule.universe.length}-stock market. Raise one so they add up to more than ${rule.universe.length}.`
                  : `The two branches cannot both fire: ${rule.risingThreshold} + ${rule.fallingThreshold} is more than the ${rule.universe.length} stocks counted.`}
              </p>
            </div>
          </>
        ) : null}

        {rule.template === 'SCRIPTED_PATH' ? (
          <ScriptedPathEditor
            prices={rule.prices}
            rounds={config.rounds}
            minPrice={config.minPrice}
            editable={editable}
            onChange={(prices) => setRule({ ...rule, prices })}
          />
        ) : null}

        {/* Disclosure wording. */}
        <div>
          <span className="label">Rule reveals</span>
          <div className="space-y-2">
            {stock.disclosure.segments.map((text, i) => (
              <div key={i}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-lavender">
                    {disclosureLabel(i)} — round {config.disclosure.rounds[i]}
                  </span>
                  {editable && i > 0 ? (
                    <button
                      className="btn-ghost px-2 py-0.5 text-[11px]"
                      onClick={() =>
                        update((draft) => {
                          const segments = [...draft.disclosure.segments] as typeof draft.disclosure.segments;
                          [segments[i - 1], segments[i]] = [segments[i], segments[i - 1]];
                          draft.disclosure.segments = segments;
                        })
                      }
                    >
                      Move earlier
                    </button>
                  ) : null}
                </div>
                <textarea
                  className="field min-h-[72px] text-sm"
                  value={text}
                  disabled={!editable}
                  maxLength={4000}
                  onChange={(e) =>
                    update((draft) => {
                      const segments = [...draft.disclosure.segments] as typeof draft.disclosure.segments;
                      segments[i] = e.target.value;
                      draft.disclosure.segments = segments;
                    })
                  }
                />
              </div>
            ))}
          </div>
          {editable ? (
            <button
              className="btn-ghost mt-2 text-xs"
              onClick={() =>
                update((draft) => {
                  draft.disclosure = defaultDisclosures(draft.rule, {
                    stockName: draft.name,
                    nameOf,
                    minPrice: config.minPrice,
                  });
                })
              }
            >
              Rewrite these from the rule
            </button>
          ) : null}
        </div>

        <button className="btn-primary w-full" onClick={onClose}>
          Done
        </button>
      </div>
    </Sheet>
  );
}

/** A sensible starting point when the administrator switches mechanic. */
function blankRule(template: RuleTemplateId, config: SessionConfig, stockId: string): RuleParams {
  const other = config.stocks.find((s) => s.id !== stockId)?.id ?? stockId;
  const preset = classicPreset({ rounds: config.rounds, minPrice: config.minPrice });
  const fromPreset = preset.stocks.find((s) => s.rule.template === template)?.rule;
  if (fromPreset) {
    const copy = structuredClone(fromPreset);
    if (copy.template === 'CROSS_STOCK_DIRECTION' && copy.referenceStockId === stockId)
      copy.referenceStockId = other;
    if (copy.template === 'RELATIVE_BUY_VOLUME' && copy.comparisonStockId === stockId)
      copy.comparisonStockId = other;
    if (copy.template === 'MARKET_SENTIMENT') copy.universe = config.stocks.map((s) => s.id);
    return copy;
  }
  return { template: 'UNCHANGED' };
}

/* ---------------------------------------------------------------- */
/* Scripted price path editor                                        */
/* ---------------------------------------------------------------- */

function ScriptedPathEditor({
  prices,
  rounds,
  minPrice,
  editable,
  onChange,
}: {
  prices: number[];
  rounds: number;
  minPrice: number;
  editable: boolean;
  onChange: (prices: number[]) => void;
}) {
  const missing = Math.max(0, rounds - (prices.length - 1));

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="label mb-0">Price path</span>
        {editable ? (
          <div className="flex gap-2">
            <button
              className="btn-ghost px-2 py-1 text-[11px]"
              onClick={() => onChange(rescale(prices, rounds, minPrice))}
              title="Keep the shape, fit it to the configured number of rounds"
            >
              Rescale to {rounds} rounds
            </button>
            <button
              className="btn-ghost px-2 py-1 text-[11px]"
              onClick={() => {
                const next = [...prices];
                while (next.length - 1 < rounds) next.push(next[next.length - 1] ?? minPrice);
                onChange(next.slice(0, rounds + 1));
              }}
            >
              Fill flat
            </button>
          </div>
        ) : null}
      </div>

      {missing > 0 ? (
        <p className="mb-2 rounded-md bg-down/15 px-2 py-1 text-xs text-down">
          {missing} round{missing === 1 ? '' : 's'} have no scheduled price. Every configured round needs
          exactly one.
        </p>
      ) : null}

      <div className="scroll-x max-h-72 overflow-y-auto rounded-lg border border-white/8">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface2">
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="px-2 py-1.5">Round</th>
              <th className="px-2 py-1.5">Price</th>
              <th className="px-2 py-1.5 text-right">vs previous</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {Array.from({ length: rounds }, (_, i) => i + 1).map((round) => {
              const value = prices[round];
              const previous = round > 1 ? prices[round - 1] : undefined;
              const change =
                value != null && previous != null && previous !== 0
                  ? ((value - previous) / previous) * 100
                  : null;
              return (
                <tr key={round}>
                  <td className="tabular px-2 py-1 text-muted">{round}</td>
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      className="tabular w-28 rounded border border-white/10 bg-concrete/70 px-2 py-1 text-sm"
                      value={value ?? ''}
                      min={0}
                      disabled={!editable}
                      onChange={(e) => {
                        const next = [...prices];
                        while (next.length <= round) next.push(minPrice);
                        next[round] = Math.max(0, Math.round(Number(e.target.value) || 0));
                        onChange(next);
                      }}
                    />
                  </td>
                  <td
                    className={clsx(
                      'tabular px-2 py-1 text-right text-xs',
                      change == null ? 'text-muted' : change > 0 ? 'text-up' : change < 0 ? 'text-down' : 'text-muted',
                    )}
                  >
                    {change == null ? '—' : pct(change)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-xs text-muted">
        Prices below the {won(minPrice)} won floor are raised to the floor when the round settles.
      </p>
    </div>
  );
}

/** Proportional rescale, mirroring the engine helper. */
function rescale(prices: number[], newRounds: number, minPrice: number): number[] {
  const oldRounds = prices.length - 1;
  if (oldRounds < 1) return prices;
  const out: number[] = [0];
  for (let r = 1; r <= newRounds; r++) {
    const position = newRounds === 1 ? 1 : 1 + ((r - 1) * (oldRounds - 1)) / (newRounds - 1);
    const lo = Math.floor(position);
    const hi = Math.min(oldRounds, lo + 1);
    const frac = position - lo;
    const a = prices[lo] ?? prices[oldRounds];
    const b = prices[hi] ?? prices[oldRounds];
    out.push(Math.max(minPrice, Math.round(a + (b - a) * frac)));
  }
  return out;
}

/* ---------------------------------------------------------------- */
/* Preview                                                           */
/* ---------------------------------------------------------------- */

function RulePreview({
  gameId,
  config,
  stockId,
  onClose,
}: {
  gameId: string;
  config: SessionConfig;
  stockId: string;
  onClose: () => void;
}) {
  const stock = config.stocks.find((s) => s.id === stockId);
  const [holdings, setHoldings] = useState(20);
  const [previousHoldings, setPreviousHoldings] = useState(0);
  const [grossBuys, setGrossBuys] = useState(10);
  const [secret, setSecret] = useState(false);
  const [rising, setRising] = useState(4);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!stock) return;
    setBusy(true);
    setError(null);
    try {
      const reference =
        stock.rule.template === 'SECRET_DEPENDENT' ? stock.rule.referenceStockId : stockId;
      const comparison =
        stock.rule.template === 'RELATIVE_BUY_VOLUME' ? stock.rule.comparisonStockId : null;
      const next = await api<PreviewResult>(`/api/admin/games/${gameId}/preview`, {
        method: 'POST',
        body: JSON.stringify({
          holdings: { [stockId]: holdings },
          previousHoldings: { [stockId]: previousHoldings },
          grossBuys: { [stockId]: grossBuys, ...(comparison ? { [comparison]: 0 } : {}) },
          secretActive: { [reference]: secret },
          forceRisingCount: rising,
        }),
      });
      setResult(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The preview failed.');
    } finally {
      setBusy(false);
    }
  }

  if (!stock) return null;
  const mine = result?.evaluations.find((e) => e.stockId === stockId);

  return (
    <Sheet open onClose={onClose} title={`Preview — ${stock.name}`} wide>
      <p className="text-sm text-muted">
        Set a hypothetical market state and settle one round through the real engine. Nothing here
        touches the live session.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <NumberField label="Total holdings at the close" value={holdings} min={0} onChange={(n) => setHoldings(Math.max(0, Math.round(n)))} />
        <NumberField
          label="Total holdings one round earlier"
          value={previousHoldings}
          min={0}
          onChange={(n) => setPreviousHoldings(Math.max(0, Math.round(n)))}
        />
        <NumberField label="Shares bought this round" value={grossBuys} min={0} onChange={(n) => setGrossBuys(Math.max(0, Math.round(n)))} />
        <NumberField
          label="Stocks counted as having risen"
          value={rising}
          min={0}
          onChange={(n) => setRising(Math.max(0, Math.round(n)))}
        />
        <label className="flex items-center gap-2 pt-5 text-sm text-ink">
          <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} />
          A secret is active on the watched stock
        </label>
      </div>

      <button className="btn-primary mt-4 w-full" onClick={run} disabled={busy}>
        {busy ? <Spinner /> : null} Settle this round
      </button>

      {error ? <p className="mt-3 rounded-lg bg-down/15 px-3 py-2 text-sm text-down">{error}</p> : null}

      {mine ? (
        <div className="mt-4 space-y-3">
          <div className="card bg-violet/10 p-3">
            <div className="label mb-1">{stock.name}</div>
            <div className="tabular text-lg font-bold text-ink">
              {won(mine.openingPrice)} → {won(mine.finalPrice)} won{' '}
              <span className={mine.appliedDelta >= 0 ? 'text-up' : 'text-down'}>
                ({signed(mine.appliedDelta)})
              </span>
            </div>
            <p className="mt-1 text-sm text-ink/90">{mine.explanation}</p>
            {mine.flooredAtMin ? (
              <p className="mt-1 text-xs text-amber-300">This settlement hit the price floor.</p>
            ) : null}
          </div>

          <details>
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-lavender">
              Every stock in this hypothetical round
            </summary>
            <table className="mt-2 w-full text-sm">
              <tbody className="divide-y divide-white/5">
                {result?.evaluations.map((e) => (
                  <tr key={e.stockId}>
                    <td className="py-1.5 pr-2 text-ink">{e.stockName}</td>
                    <td className="tabular py-1.5 text-right text-muted">{won(e.openingPrice)}</td>
                    <td className={clsx('tabular py-1.5 px-2 text-right', e.appliedDelta >= 0 ? 'text-up' : 'text-down')}>
                      {signed(e.appliedDelta)}
                    </td>
                    <td className="tabular py-1.5 text-right font-semibold text-ink">{won(e.finalPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      ) : null}
    </Sheet>
  );
}
