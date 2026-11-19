'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import clsx from 'clsx';
import { ApiError, api, useCountdown, useLiveState } from '@/lib/client';
import { Card, Chip, SectionTitle, Sheet, Spinner, Toasts, useToasts } from '@/components/ui';
import { Overview } from '@/components/admin/Overview';
import { ConfigEditor } from '@/components/admin/ConfigEditor';
import { RuleCards } from '@/components/admin/RuleCards';
import { Readiness } from '@/components/admin/Readiness';
import { Participants } from '@/components/admin/Participants';
import { MarketActivity } from '@/components/admin/MarketActivity';
import { Simulation } from '@/components/admin/Simulation';
import { Results } from '@/components/admin/Results';
import { Assistant } from '@/components/admin/Assistant';
import type { AdminState, ConfigResponse, ReadinessReport } from '@/lib/admin-types';
import type { SessionConfig } from '@/engine/types';

type Tab =
  | 'dashboard'
  | 'configuration'
  | 'rules'
  | 'participants'
  | 'market'
  | 'secrets'
  | 'testing'
  | 'results';

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'configuration', label: 'Configuration' },
  { id: 'rules', label: 'Stocks & rules' },
  { id: 'participants', label: 'Participants' },
  { id: 'market', label: 'Market activity' },
  { id: 'secrets', label: 'Intelligence & secrets' },
  { id: 'testing', label: 'Simulation & testing' },
  { id: 'results', label: 'Final results' },
];

export default function AdminGamePage() {
  const params = useParams<{ gameId: string }>();
  const gameId = params.gameId;
  const toasts = useToasts();

  const [tab, setTab] = useState<Tab>('dashboard');
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [draft, setDraft] = useState<SessionConfig | null>(null);
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const { state, error, loading, refresh } = useLiveState<AdminState>(
    `/api/admin/games/${gameId}/state`,
    `/api/events/${gameId}`,
    { pollMs: 6000 },
  );
  const seconds = useCountdown(state?.game.secondsRemaining, state?.game.serverTime);

  const loadConfig = useCallback(async () => {
    try {
      const result = await api<ConfigResponse>(`/api/admin/games/${gameId}/config`);
      setConfig(result);
      setDraft(result.config);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setAuthError('Please sign in as an administrator.');
      else toasts.error(e instanceof Error ? e.message : 'Could not load the configuration.');
    }
    // toasts is stable enough for this; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const editable = config?.game.status === 'draft' || config?.game.status === 'registration';
  const dirty = Boolean(draft && config && JSON.stringify(draft) !== JSON.stringify(config.config));

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      await api(`/api/admin/games/${gameId}/config`, { method: 'PUT', body: JSON.stringify(draft) });
      await loadConfig();
      toasts.success('Configuration saved');
    } catch (e) {
      toasts.error(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  async function lifecycle(action: string, extra?: Record<string, unknown>) {
    setBusy(true);
    try {
      await api(`/api/admin/games/${gameId}/lifecycle`, {
        method: 'POST',
        body: JSON.stringify({ action, ...extra }),
      });
      await Promise.all([refresh(), loadConfig()]);
      toasts.success(
        action === 'start'
          ? 'The game has started and registration is closed'
          : `Done: ${action.replace(/-/g, ' ')}`,
      );
    } catch (e) {
      toasts.error(e instanceof Error ? e.message : 'That action failed.');
    } finally {
      setBusy(false);
    }
  }

  async function runReadiness() {
    setTesting(true);
    try {
      setReport(await api<ReadinessReport>(`/api/admin/games/${gameId}/readiness`, { method: 'POST' }));
    } catch (e) {
      toasts.error(e instanceof Error ? e.message : 'The readiness check failed.');
    } finally {
      setTesting(false);
    }
  }

  if (authError) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 text-center">
        <p className="text-ink">{authError}</p>
        <Link href="/admin" className="btn-primary">
          Go to sign in
        </Link>
      </main>
    );
  }

  if (loading || !state || !draft || !config) {
    return (
      <main className="flex min-h-dvh items-center justify-center text-muted">
        <Spinner className="mr-2" /> {error ?? 'Loading the control room…'}
      </main>
    );
  }

  const joinUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/join?code=${config.game.joinCode}`
      : `/join?code=${config.game.joinCode}`;

  return (
    <div className="min-h-dvh pb-12">
      <header className="sticky top-0 z-20 border-b border-white/8 bg-concrete/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-2.5">
          <Link href="/admin" className="text-xs font-semibold uppercase tracking-[0.2em] text-muted hover:text-ink">
            ← Sessions
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-bold text-ink">{state.game.name}</h1>
            <div className="tabular text-xs text-muted">
              Round {state.game.round}/{state.game.totalRounds} · code{' '}
              <span className="font-semibold text-lavender">{config.game.joinCode}</span>
            </div>
          </div>
          <Chip tone={state.game.status === 'running' ? 'up' : 'neutral'}>{state.game.status}</Chip>
        </div>

        <nav className="scroll-x mx-auto flex max-w-6xl gap-1 px-3 pb-2" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={clsx(
                'shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                tab === t.id ? 'bg-violet text-ink' : 'text-muted hover:bg-white/5 hover:text-ink',
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {dirty ? (
        <div className="sticky top-[86px] z-10 border-b border-lavender/25 bg-violet/15 px-4 py-2">
          <div className="mx-auto flex max-w-6xl items-center gap-3">
            <span className="flex-1 text-xs text-ink">You have unsaved configuration changes.</span>
            <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setDraft(config.config)}>
              Discard
            </button>
            <button className="btn-primary px-3 py-1.5 text-xs" onClick={save} disabled={saving}>
              {saving ? <Spinner /> : null} Save
            </button>
          </div>
        </div>
      ) : null}

      <main className="mx-auto max-w-6xl px-4 py-5">
        {tab === 'dashboard' ? (
          <div className="space-y-4">
            <Overview
              state={state}
              config={config}
              seconds={seconds}
              busy={busy}
              onAction={lifecycle}
              onAnnounce={async (body) => {
                try {
                  await api(`/api/admin/games/${gameId}/announce`, {
                    method: 'POST',
                    body: JSON.stringify({ body }),
                  });
                  toasts.success('Announcement sent');
                  void refresh();
                } catch (e) {
                  toasts.error(e instanceof Error ? e.message : 'Could not send that.');
                }
              }}
            />
            <DisplayLink gameId={gameId} config={config} onChanged={loadConfig} toastError={toasts.error} />
          </div>
        ) : null}

        {tab === 'configuration' ? (
          <div className="space-y-4">
            <Provenance config={config} onSaveTemplate={() => setSavingTemplate(true)} />
            <ConfigEditor config={draft} editable={Boolean(editable)} onChange={setDraft} />
          </div>
        ) : null}

        {tab === 'rules' ? (
          <RuleCards config={draft} editable={Boolean(editable)} onChange={setDraft} />
        ) : null}

        {tab === 'participants' ? (
          <Participants gameId={gameId} state={state} joinUrl={joinUrl} />
        ) : null}

        {tab === 'market' ? <MarketActivity gameId={gameId} state={state} /> : null}

        {tab === 'secrets' ? <SecretsAndIntel state={state} config={draft} /> : null}

        {tab === 'testing' ? (
          <div className="space-y-6">
            <Readiness
              report={report}
              busy={testing}
              onRun={runReadiness}
              onJumpToRule={(stockId) => {
                setTab('rules');
                setTimeout(
                  () => document.getElementById(`rule-${stockId}`)?.scrollIntoView({ behavior: 'smooth' }),
                  80,
                );
              }}
              onAcknowledge={() => void lifecycle('acknowledge-warnings')}
              warningsAcknowledged={config.game.warningsAcknowledged}
            />
            <Simulation gameId={gameId} config={draft} />
            <Assistant gameId={gameId} />
          </div>
        ) : null}

        {tab === 'results' ? <Results gameId={gameId} /> : null}
      </main>

      {savingTemplate ? (
        <SaveAsTemplateSheet
          config={draft}
          derivedFrom={config.game.templateName ?? undefined}
          onClose={() => setSavingTemplate(false)}
          onSaved={() => {
            setSavingTemplate(false);
            toasts.success('Saved as a template — it will appear when you create a session');
          }}
          onError={toasts.error}
        />
      ) : null}

      <Toasts toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </div>
  );
}

/** Where this session's rules came from, and how to keep them. */
function Provenance({
  config,
  onSaveTemplate,
}: {
  config: ConfigResponse;
  onSaveTemplate: () => void;
}) {
  return (
    <Card>
      <SectionTitle hint="Where this game came from">Template</SectionTitle>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-ink">{config.game.templateName ?? 'Custom configuration'}</span>
        {config.game.scrambleSeed ? (
          <Chip tone="violet">scrambled · seed {config.game.scrambleSeed}</Chip>
        ) : (
          <Chip tone="neutral">as published</Chip>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">
        {config.game.scrambleSeed
          ? 'The mechanics were re-assigned and the numbers varied for this session, so anyone who has played this template before gets no head start. Reuse the seed to recreate exactly this game for another class.'
          : 'This session runs the template exactly as published. If any of your participants have played it before, create the next one with scrambling switched on.'}
      </p>
      <button className="btn-secondary mt-3" onClick={onSaveTemplate}>
        Save as template
      </button>
    </Card>
  );
}

/** Keeps the current configuration as a reusable template. */
function SaveAsTemplateSheet({
  config,
  derivedFrom,
  onClose,
  onSaved,
  onError,
}: {
  config: SessionConfig;
  derivedFrom?: string;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(`${config.name} template`);
  const [description, setDescription] = useState('');
  const [designerNote, setDesignerNote] = useState('');
  const [isShared, setIsShared] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api('/api/admin/templates', {
        method: 'POST',
        body: JSON.stringify({ name, description, designerNote, isShared, derivedFrom, config }),
      });
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not save the template.');
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title="Save as template">
      <p className="text-sm text-muted">
        Keeps these companies, mechanics, numbers and settings so you can start another session from
        them. The saved template is a snapshot: later changes to this session will not affect it.
      </p>

      <label className="mt-4 block">
        <span className="label">Template name</span>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      </label>

      <label className="mt-3 block">
        <span className="label">Description</span>
        <input
          className="field"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={600}
          placeholder="What this game is like to play"
        />
      </label>

      <label className="mt-3 block">
        <span className="label">Note to yourself</span>
        <input
          className="field"
          value={designerNote}
          onChange={(e) => setDesignerNote(e.target.value)}
          maxLength={600}
          placeholder="What to watch for when you run it"
        />
      </label>

      <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-lg border border-white/8 p-3">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4"
          checked={isShared}
          onChange={(e) => setIsShared(e.target.checked)}
        />
        <span>
          <span className="block text-sm font-medium text-ink">
            Share with other administrators
          </span>
          <span className="mt-0.5 block text-xs text-muted">
            They can start sessions from it but cannot change it.
          </span>
        </span>
      </label>

      <button className="btn-primary mt-5 w-full" onClick={save} disabled={busy || name.trim().length < 2}>
        {busy ? <Spinner /> : null} Save template
      </button>
    </Sheet>
  );
}

function DisplayLink({
  gameId,
  config,
  onChanged,
  toastError,
}: {
  gameId: string;
  config: ConfigResponse;
  onChanged: () => void | Promise<void>;
  toastError: (t: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const token = config.game.displayToken;
  const url =
    token && typeof window !== 'undefined'
      ? `${window.location.origin}/display/${gameId}?token=${token}`
      : null;

  async function act(method: 'POST' | 'DELETE') {
    setBusy(true);
    try {
      await api(`/api/admin/games/${gameId}/display-token`, { method });
      await onChanged();
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'That failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <SectionTitle hint="Read-only, no login, not indexed">Classroom display board</SectionTitle>
      {url ? (
        <>
          <code className="tabular block overflow-x-auto rounded-lg bg-concrete/70 px-3 py-2.5 text-xs text-lavender">
            {url}
          </code>
          <div className="mt-2 flex flex-wrap gap-2">
            <a href={url} target="_blank" rel="noreferrer" className="btn-secondary text-xs">
              Open the board
            </a>
            <button className="btn-ghost text-xs" onClick={() => void navigator.clipboard?.writeText(url)}>
              Copy link
            </button>
            <button className="btn-ghost text-xs" onClick={() => void act('POST')} disabled={busy}>
              Regenerate
            </button>
            <button className="btn-ghost text-xs text-down" onClick={() => void act('DELETE')} disabled={busy}>
              Revoke
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">
            This page cannot trade, cannot reach administrator controls, does not reveal hidden rules
            and respects active secrets. Revoking the link stops it working immediately.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm text-muted">
            No display link exists. Generate one to put the live market on a projector.
          </p>
          <button className="btn-primary mt-3" onClick={() => void act('POST')} disabled={busy}>
            {busy ? <Spinner /> : null} Generate a display link
          </button>
        </>
      )}
    </Card>
  );
}

function SecretsAndIntel({ state, config }: { state: AdminState; config: SessionConfig }) {
  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle>Secrets in force</SectionTitle>
        {state.admin.activeSecrets.length === 0 ? (
          <p className="text-sm text-muted">No secret is active right now.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {state.admin.activeSecrets.map((s, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 border-b border-white/5 pb-1.5">
                <Chip tone="violet">
                  R{s.firstRound}–{s.lastRound}
                </Chip>
                <span className="text-ink">
                  {state.stocks.find((x) => x.id === s.stockId)?.name ?? s.stockId}
                </span>
                <span className="ml-auto text-xs text-muted">imposed by {s.imposedBy}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">
          Only you can see who imposed a secret. Participants see that a stock is concealed, never by
          whom.
        </p>
      </Card>

      <Card>
        <SectionTitle>Settings in force</SectionTitle>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row label="Secrets" value={config.secrets.enabled ? 'Enabled' : 'Disabled'} />
          <Row label="Tokens per participant" value={String(config.secrets.tokensPerParticipant)} />
          <Row label="Duration" value={`${config.secrets.durationRounds} rounds`} />
          <Row label="Latest activation" value={`Round ${config.secrets.latestActivationRound}`} />
          <Row
            label="Trading during a secret"
            value={config.secrets.tradingDuringSecret === 'enabled' ? 'Continues' : 'Suspended'}
          />
          <Row
            label="Simultaneous activations"
            value={
              config.secrets.allowSimultaneous
                ? config.secrets.simultaneousExtendsDuration
                  ? 'Allowed, and they extend the duration'
                  : 'Allowed; tokens are consumed but the period is not extended'
                : 'Not allowed'
            }
          />
          <Row label="Intelligence" value={config.intel.mode} />
          <Row label="Starting Pieces" value={String(config.intel.startingPieces)} />
          <Row
            label="Piece exchange"
            value={
              config.intel.allowPieceToCash
                ? `1 Piece = ${config.intel.pieceToCashWon.toLocaleString('en-US')} won`
                : 'Not allowed'
            }
          />
          <Row label="Intelligence deadline" value={`Round ${config.intel.deadlineRound}`} />
        </dl>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-white/5 pb-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-ink">{value}</dd>
    </div>
  );
}
