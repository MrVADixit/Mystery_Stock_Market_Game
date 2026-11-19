'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { Card, Chip, SectionTitle } from '@/components/ui';
import { won } from '@/lib/format';
import { addStock, removeStock, EditError } from '@/engine/edit';
import { templateOf } from '@/engine/templates';
import type { SessionConfig } from '@/engine/types';

type Section = 'general' | 'stocks' | 'secrets' | 'intel' | 'disclosure' | 'trading' | 'public';

const STEPS: { id: Section; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'stocks', label: 'Stocks & prices' },
  { id: 'secrets', label: 'Secrets' },
  { id: 'intel', label: 'Intelligence & Pieces' },
  { id: 'disclosure', label: 'Rule reveals' },
  { id: 'trading', label: 'Trading limits' },
  { id: 'public', label: 'Public information' },
];

function Num({
  label,
  value,
  onChange,
  hint,
  suffix,
  min,
  step = 1,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  hint?: string;
  suffix?: string;
  min?: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="number"
          className="field tabular"
          value={value}
          min={min}
          step={step}
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

function Toggle({
  label,
  checked,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-white/8 p-3">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

/**
 * The CUSTOMIZE wizard (§7).
 *
 * Nothing here is mandatory: the classic preset is already a complete,
 * playable configuration, and every optional feature can be left alone.
 */
export function ConfigEditor({
  config,
  editable,
  onChange,
}: {
  config: SessionConfig;
  editable: boolean;
  onChange: (next: SessionConfig) => void;
}) {
  const [section, setSection] = useState<Section>('general');
  const set = (mutate: (draft: SessionConfig) => void) => {
    const next = structuredClone(config);
    mutate(next);
    onChange(next);
  };

  return (
    <div className="space-y-4">
      {!editable ? (
        <p className="rounded-lg bg-surface2/60 p-3 text-sm text-muted">
          The game has started, so the configuration is locked. Everything below is read-only.
        </p>
      ) : null}

      <nav className="scroll-x -mx-1 flex gap-1.5 px-1" aria-label="Configuration sections">
        {STEPS.map((step, i) => (
          <button
            key={step.id}
            onClick={() => setSection(step.id)}
            className={clsx(
              'shrink-0 rounded-lg px-3 py-2 text-xs font-semibold transition-colors',
              section === step.id ? 'bg-violet text-ink' : 'bg-surface2 text-muted hover:text-ink',
            )}
          >
            <span className="tabular mr-1.5 opacity-60">{i + 1}</span>
            {step.label}
          </button>
        ))}
      </nav>

      {section === 'general' ? (
        <Card>
          <SectionTitle>General settings</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="label">Game name</span>
              <input
                className="field"
                value={config.name}
                maxLength={120}
                disabled={!editable}
                onChange={(e) =>
                  set((d) => {
                    d.name = e.target.value;
                  })
                }
              />
            </label>
            <Num
              label="Starting cash"
              value={config.startingCash}
              suffix="won"
              min={0}
              disabled={!editable}
              onChange={(n) =>
                set((d) => {
                  d.startingCash = Math.max(0, Math.round(n));
                })
              }
            />
            <Num
              label="Number of rounds"
              value={config.rounds}
              min={1}
              disabled={!editable}
              hint="Changing this may require rescaling a scripted price path."
              onChange={(n) =>
                set((d) => {
                  d.rounds = Math.max(1, Math.round(n));
                })
              }
            />
            <Num
              label="Round duration"
              value={Math.round(config.roundSeconds / 60 * 10) / 10}
              suffix="minutes"
              step={0.5}
              min={0.5}
              disabled={!editable}
              onChange={(n) =>
                set((d) => {
                  d.roundSeconds = Math.max(5, Math.round(n * 60));
                })
              }
            />
            <Num
              label="Minimum price (floor)"
              value={config.minPrice}
              suffix="won"
              min={1}
              disabled={!editable}
              hint="Always enforced after every settlement, in every configuration."
              onChange={(n) =>
                set((d) => {
                  d.minPrice = Math.max(1, Math.round(n));
                })
              }
            />
            <Num
              label="Maximum price (ceiling)"
              value={config.maxPrice ?? 0}
              suffix="won (0 = none)"
              min={0}
              disabled={!editable}
              onChange={(n) =>
                set((d) => {
                  d.maxPrice = n < 1 ? null : Math.round(n);
                })
              }
            />
            <Num
              label="Maximum movement per round"
              value={config.maxMovePerRoundBps != null ? config.maxMovePerRoundBps / 100 : 0}
              suffix="% (0 = uncapped)"
              step={1}
              min={0}
              disabled={!editable}
              hint="Off by default, so the classic preset's mechanics are untouched."
              onChange={(n) =>
                set((d) => {
                  d.maxMovePerRoundBps = n < 0.01 ? null : Math.round(n * 100);
                })
              }
            />
          </div>
        </Card>
      ) : null}

      {section === 'stocks' ? (
        <StocksSection config={config} editable={editable} onChange={onChange} set={set} />
      ) : null}

      {section === 'secrets' ? (
        <Card>
          <SectionTitle>Secret settings</SectionTitle>
          <div className="space-y-3">
            <Toggle
              label="Secrets are available"
              checked={config.secrets.enabled}
              disabled={!editable}
              onChange={(v) =>
                set((d) => {
                  d.secrets.enabled = v;
                })
              }
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Num
                label="Tokens per participant"
                value={config.secrets.tokensPerParticipant}
                min={0}
                disabled={!editable || !config.secrets.enabled}
                onChange={(n) =>
                  set((d) => {
                    d.secrets.tokensPerParticipant = Math.max(0, Math.round(n));
                  })
                }
              />
              <Num
                label="Duration"
                value={config.secrets.durationRounds}
                suffix="rounds"
                min={1}
                disabled={!editable || !config.secrets.enabled}
                hint="A secret imposed in round 2 with a duration of 2 covers rounds 3 and 4."
                onChange={(n) =>
                  set((d) => {
                    d.secrets.durationRounds = Math.max(1, Math.round(n));
                  })
                }
              />
              <Num
                label="Latest activation round"
                value={config.secrets.latestActivationRound}
                min={1}
                disabled={!editable || !config.secrets.enabled}
                onChange={(n) =>
                  set((d) => {
                    d.secrets.latestActivationRound = Math.max(1, Math.round(n));
                  })
                }
              />
              <label className="block">
                <span className="label">Trading during a secret</span>
                <select
                  className="field"
                  value={config.secrets.tradingDuringSecret}
                  disabled={!editable || !config.secrets.enabled}
                  onChange={(e) =>
                    set((d) => {
                      d.secrets.tradingDuringSecret = e.target.value as 'enabled' | 'suspended';
                    })
                  }
                >
                  <option value="enabled">Continues at the concealed price (default)</option>
                  <option value="suspended">Suspended in the affected stock</option>
                </select>
              </label>
            </div>

            <div className="label mt-2">What a secret conceals</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Toggle
                label="Stock price"
                checked={config.secrets.hidePrice}
                disabled={!editable}
                onChange={(v) =>
                  set((d) => {
                    d.secrets.hidePrice = v;
                  })
                }
              />
              <Toggle
                label="Trading activity"
                checked={config.secrets.hideVolume}
                disabled={!editable}
                onChange={(v) =>
                  set((d) => {
                    d.secrets.hideVolume = v;
                  })
                }
              />
              <Toggle
                label="Aggregate holdings"
                checked={config.secrets.hideHoldings}
                disabled={!editable}
                onChange={(v) =>
                  set((d) => {
                    d.secrets.hideHoldings = v;
                  })
                }
              />
              <Toggle
                label="Everyone's total asset figures"
                hint="Rankings stay visible either way."
                checked={config.secrets.hideParticipantAssets}
                disabled={!editable}
                onChange={(v) =>
                  set((d) => {
                    d.secrets.hideParticipantAssets = v;
                  })
                }
              />
              <Toggle
                label="Mask the assets of anyone holding the affected stock"
                checked={config.secrets.maskHolderAssets}
                disabled={!editable}
                onChange={(v) =>
                  set((d) => {
                    d.secrets.maskHolderAssets = v;
                  })
                }
              />
            </div>

            <div className="label mt-2">Simultaneous secrets</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Toggle
                label="Allow more than one secret on the same stock"
                checked={config.secrets.allowSimultaneous}
                disabled={!editable}
                onChange={(v) =>
                  set((d) => {
                    d.secrets.allowSimultaneous = v;
                  })
                }
              />
              <Toggle
                label="Simultaneous activations extend the duration"
                hint="Off by default: every token is consumed but the stock gets one normal secret period."
                checked={config.secrets.simultaneousExtendsDuration}
                disabled={!editable}
                onChange={(v) =>
                  set((d) => {
                    d.secrets.simultaneousExtendsDuration = v;
                  })
                }
              />
            </div>
          </div>
        </Card>
      ) : null}

      {section === 'intel' ? (
        <Card>
          <SectionTitle>Intelligence and the Piece economy</SectionTitle>
          <label className="block">
            <span className="label">How intelligence is paid for</span>
            <select
              className="field"
              value={config.intel.mode}
              disabled={!editable}
              onChange={(e) =>
                set((d) => {
                  d.intel.mode = e.target.value as 'pieces' | 'cash' | 'disabled';
                })
              }
            >
              <option value="pieces">Pieces (default)</option>
              <option value="cash">A fixed cash price</option>
              <option value="disabled">Intelligence disabled</option>
            </select>
          </label>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {config.intel.mode === 'pieces' ? (
              <>
                <Num
                  label="Starting Pieces"
                  value={config.intel.startingPieces}
                  min={0}
                  disabled={!editable}
                  onChange={(n) =>
                    set((d) => {
                      d.intel.startingPieces = Math.max(0, Math.round(n));
                    })
                  }
                />
                <Num
                  label="Cash cost of one extra Piece"
                  value={config.intel.piecePurchaseCostWon ?? 0}
                  suffix="won (0 = cannot buy)"
                  min={0}
                  disabled={!editable}
                  onChange={(n) =>
                    set((d) => {
                      d.intel.piecePurchaseCostWon = n < 1 ? null : Math.round(n);
                    })
                  }
                />
                <Num
                  label="Piece-to-cash exchange rate"
                  value={config.intel.pieceToCashWon}
                  suffix="won per Piece"
                  min={0}
                  disabled={!editable || !config.intel.allowPieceToCash}
                  onChange={(n) =>
                    set((d) => {
                      d.intel.pieceToCashWon = Math.max(0, Math.round(n));
                    })
                  }
                />
                <Toggle
                  label="Pieces can be exchanged for cash"
                  hint={`Currently 1 Piece = ${won(config.intel.pieceToCashWon)} won.`}
                  checked={config.intel.allowPieceToCash}
                  disabled={!editable}
                  onChange={(v) =>
                    set((d) => {
                      d.intel.allowPieceToCash = v;
                    })
                  }
                />
              </>
            ) : null}

            {config.intel.mode === 'cash' ? (
              <Num
                label="Price per intelligence purchase"
                value={config.intel.cashPricePerIntelWon}
                suffix="won"
                min={1}
                disabled={!editable}
                onChange={(n) =>
                  set((d) => {
                    d.intel.cashPricePerIntelWon = Math.max(0, Math.round(n));
                  })
                }
              />
            ) : null}

            {config.intel.mode !== 'disabled' ? (
              <Num
                label="Purchases close at the end of round"
                value={config.intel.deadlineRound}
                min={1}
                disabled={!editable}
                onChange={(n) =>
                  set((d) => {
                    d.intel.deadlineRound = Math.max(1, Math.round(n));
                  })
                }
              />
            ) : null}
          </div>
        </Card>
      ) : null}

      {section === 'disclosure' ? (
        <Card>
          <SectionTitle hint="The wording is edited on each rule card">Rule reveal schedule</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-4">
            {config.disclosure.rounds.map((round, i) => (
              <Num
                key={i}
                label={['First reveal', 'Second reveal', 'Third reveal', 'Full disclosure'][i]}
                value={round}
                suffix="round"
                min={1}
                disabled={!editable}
                onChange={(n) =>
                  set((d) => {
                    d.disclosure.rounds[i] = Math.max(1, Math.round(n));
                  })
                }
              />
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            Each reveal must come after the one before it and fall within rounds 1–{config.rounds}. At
            the final reveal every rule becomes completely public.
          </p>
        </Card>
      ) : null}

      {section === 'trading' ? (
        <Card>
          <SectionTitle>Trading restrictions</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <Num
              label="Maximum shares in one order"
              value={config.trading.maxSharesPerOrder ?? 0}
              suffix="shares (0 = no cap)"
              min={0}
              disabled={!editable}
              onChange={(n) =>
                set((d) => {
                  d.trading.maxSharesPerOrder = n < 1 ? null : Math.round(n);
                })
              }
            />
            <Num
              label="Maximum holding of one stock per participant"
              value={config.trading.maxSharesPerParticipantPerStock ?? 0}
              suffix="shares (0 = no cap)"
              min={0}
              disabled={!editable}
              onChange={(n) =>
                set((d) => {
                  d.trading.maxSharesPerParticipantPerStock = n < 1 ? null : Math.round(n);
                })
              }
            />
          </div>
          <p className="mt-3 text-xs text-muted">
            Short selling and buying on credit are impossible by construction: no order can take a
            cash or share balance below zero.
          </p>
        </Card>
      ) : null}

      {section === 'public' ? (
        <Card>
          <SectionTitle>What participants and the display board can see</SectionTitle>
          <div className="grid gap-2 sm:grid-cols-2">
            <Toggle
              label="Aggregate holdings per stock"
              checked={config.publicInfo.showAggregateHoldings}
              disabled={!editable}
              onChange={(v) =>
                set((d) => {
                  d.publicInfo.showAggregateHoldings = v;
                })
              }
            />
            <Toggle
              label="Buying and selling volumes"
              checked={config.publicInfo.showVolumes}
              disabled={!editable}
              onChange={(v) =>
                set((d) => {
                  d.publicInfo.showVolumes = v;
                })
              }
            />
            <Toggle
              label="Leaderboard"
              checked={config.publicInfo.showLeaderboard}
              disabled={!editable}
              onChange={(v) =>
                set((d) => {
                  d.publicInfo.showLeaderboard = v;
                })
              }
            />
            <Toggle
              label="Each participant's total assets"
              checked={config.publicInfo.showParticipantAssets}
              disabled={!editable}
              onChange={(v) =>
                set((d) => {
                  d.publicInfo.showParticipantAssets = v;
                })
              }
            />
          </div>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * Companies and opening prices, with the ability to add and remove them.
 *
 * Removing a company is never a simple delete: other rules may watch it,
 * compare against it or count it in a market universe. The engine repairs
 * all of that and reports what it changed, which is shown here rather than
 * happening silently.
 */
function StocksSection({
  config,
  editable,
  onChange,
  set,
}: {
  config: SessionConfig;
  editable: boolean;
  onChange: (next: SessionConfig) => void;
  set: (mutate: (draft: SessionConfig) => void) => void;
}) {
  const [repairs, setRepairs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const apply = (action: () => { config: SessionConfig; repairs: string[] }) => {
    setError(null);
    try {
      const result = action();
      onChange(result.config);
      setRepairs(result.repairs);
    } catch (e) {
      setError(e instanceof EditError ? e.message : 'That edit could not be applied.');
      setRepairs([]);
    }
  };

  return (
    <Card>
      <SectionTitle hint="Mechanics are assigned on the Stocks & rules tab">
        Companies and opening prices
      </SectionTitle>

      <ul className="space-y-2">
        {config.stocks.map((stock, i) => (
          <li key={stock.id} className="grid gap-2 sm:grid-cols-[1fr_11rem_auto]">
            <label className="block">
              <span className="label">
                Company {i + 1}
                <span className="ml-2 normal-case tracking-normal text-muted/80">
                  {templateOf(stock.rule).title}
                </span>
              </span>
              <input
                className="field"
                value={stock.name}
                maxLength={60}
                disabled={!editable}
                onChange={(e) =>
                  set((d) => {
                    d.stocks[i].name = e.target.value;
                  })
                }
              />
            </label>
            <Num
              label="Opening price"
              value={stock.initialPrice}
              suffix="won"
              min={config.minPrice}
              disabled={!editable}
              onChange={(n) =>
                set((d) => {
                  d.stocks[i].initialPrice = Math.max(0, Math.round(n));
                })
              }
            />
            <div className="flex items-end pb-1">
              {confirming === stock.id ? (
                <span className="flex gap-1">
                  <button
                    className="btn-sell px-2 py-1.5 text-[11px]"
                    onClick={() => {
                      setConfirming(null);
                      apply(() => removeStock(config, stock.id));
                    }}
                  >
                    Remove
                  </button>
                  <button
                    className="btn-ghost px-2 py-1.5 text-[11px]"
                    onClick={() => setConfirming(null)}
                  >
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  className="btn-ghost px-2 py-1.5 text-[11px]"
                  disabled={!editable || config.stocks.length <= 1}
                  onClick={() => setConfirming(stock.id)}
                  aria-label={`Remove ${stock.name}`}
                >
                  Remove
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {editable ? (
        <button
          className="btn-secondary mt-3"
          onClick={() => apply(() => addStock(config))}
          disabled={config.stocks.length >= 40}
        >
          Add a company
        </button>
      ) : null}

      {error ? <p className="mt-3 rounded-lg bg-down/15 px-3 py-2 text-sm text-down">{error}</p> : null}

      {repairs.length > 0 ? (
        <div className="mt-3 rounded-lg bg-violet/12 p-3">
          <div className="mb-1 flex items-center gap-2">
            <Chip tone="violet">Adjusted</Chip>
            <span className="text-xs text-muted">Other rules referred to what you changed.</span>
          </div>
          <ul className="space-y-0.5">
            {repairs.map((repair, i) => (
              <li key={i} className="text-xs text-ink/90">
                • {repair}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-3 text-xs text-muted">
        A new company starts on the unchanged-price mechanic; assign it a real one on the Stocks &
        rules tab. A company running the scripted path takes its round 1 price from its schedule,
        whatever is typed here.
      </p>
    </Card>
  );
}
