'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError, api } from '@/lib/client';
import { Card, Chip, Spinner } from '@/components/ui';
import { NewSessionSheet } from '@/components/admin/TemplatePicker';

interface GameSummary {
  id: string;
  name: string;
  status: string;
  current_round: number;
  rounds: number;
  join_code: string;
  participant_count: number;
  created_at: string;
  template_name: string | null;
  scramble_seed: number | null;
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="h-4 w-4" aria-hidden>
      <path fill="#4285F4" d="M17.6 9.2c0-.6-.1-1.3-.2-1.8H9v3.5h4.8a4.1 4.1 0 01-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.6z" />
      <path fill="#34A853" d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.2a5.4 5.4 0 01-8.1-2.8H1v2.3A9 9 0 009 18z" />
      <path fill="#FBBC05" d="M3.96 10.7a5.4 5.4 0 010-3.4V5H1a9 9 0 000 8l2.96-2.3z" />
      <path fill="#EA4335" d="M9 3.6c1.3 0 2.5.5 3.4 1.3L15 2.3A9 9 0 001 5l3 2.3A5.4 5.4 0 019 3.6z" />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 fill-current" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 014 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

const STATUS_TONES: Record<string, 'neutral' | 'up' | 'violet' | 'warn'> = {
  draft: 'neutral',
  registration: 'warn',
  running: 'up',
  paused: 'warn',
  finished: 'violet',
  archived: 'neutral',
};

export default function AdminHome() {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [providers, setProviders] = useState<{ id: string; label: string }[]>([]);

  const load = useCallback(async () => {
    try {
      const result = await api<{ games: GameSummary[] }>('/api/admin/games');
      setGames(result.games);
      setAuthed(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setAuthed(false);
      else setError(e instanceof Error ? e.message : 'Could not load games.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // Read straight from the URL rather than useSearchParams, which would
    // force this whole screen behind a Suspense boundary.
    const reason = new URLSearchParams(window.location.search).get('error');
    if (reason) {
      setError(reason);
      window.history.replaceState({}, '', window.location.pathname);
    }
    api<{ providers: { id: string; label: string }[] }>('/api/auth/providers')
      .then((r) => setProviders(r.providers))
      .catch(() => setProviders([]));
  }, []);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  }

  if (authed === null) {
    return (
      <main className="flex min-h-dvh items-center justify-center text-muted">
        <Spinner className="mr-2" /> Loading…
      </main>
    );
  }

  if (!authed) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
        <Link href="/" className="mb-6 text-xs font-semibold uppercase tracking-[0.2em] text-muted hover:text-ink">
          ← Mystery Stock Market
        </Link>
        <h1 className="text-2xl font-bold text-ink">Administrator sign in</h1>
        <form onSubmit={signIn} className="card mt-5 space-y-4 p-5">
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              className="field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {error ? (
            <p role="alert" className="rounded-lg bg-down/15 px-3 py-2 text-sm text-down">
              {error}
            </p>
          ) : null}
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? <Spinner /> : null} Sign in
          </button>

          {providers.length > 0 ? (
            <>
              <div className="flex items-center gap-3 pt-1">
                <span className="h-px flex-1 bg-white/10" />
                <span className="text-[11px] uppercase tracking-wide text-muted">or</span>
                <span className="h-px flex-1 bg-white/10" />
              </div>

              {providers.map((provider) => (
                <a
                  key={provider.id}
                  href={`/api/auth/oauth/${provider.id}/start`}
                  className="btn-secondary w-full"
                >
                  {provider.id === 'google' ? <GoogleMark /> : <GitHubMark />}
                  Continue with {provider.label}
                </a>
              ))}

              <p className="text-center text-[11px] text-muted">
                Only administrators of this deployment can sign in this way.
              </p>
            </>
          ) : null}
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/" className="text-xs font-semibold uppercase tracking-[0.2em] text-muted hover:text-ink">
            Mystery Stock Market
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-ink">Your game sessions</h1>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/templates" className="btn-secondary">
            Templates
          </Link>
          <button className="btn-primary" onClick={() => setCreating(true)}>
            New session
          </button>
          <button
            className="btn-ghost"
            onClick={async () => {
              await api('/api/admin/logout', { method: 'POST' });
              router.refresh();
              setAuthed(false);
            }}
          >
            Sign out
          </button>
        </div>
      </div>

      {games.length === 0 ? (
        <Card className="mt-6">
          <p className="text-sm text-muted">
            No sessions yet. Create one — Quick start loads the complete classic preset and you can be
            running in under a minute.
          </p>
        </Card>
      ) : (
        <ul className="mt-6 space-y-2">
          {games.map((game) => (
            <li key={game.id}>
              <Link
                href={`/admin/${game.id}`}
                className="card flex items-center gap-4 p-4 transition-colors hover:border-lavender/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-ink">{game.name}</span>
                    <Chip tone={STATUS_TONES[game.status] ?? 'neutral'}>{game.status}</Chip>
                  </div>
                  <div className="tabular mt-0.5 text-xs text-muted">
                    Code <span className="font-semibold text-lavender">{game.join_code}</span> ·{' '}
                    {game.participant_count} participant{game.participant_count === 1 ? '' : 's'} ·
                    round {game.current_round}/{game.rounds}
                  </div>
                  {game.template_name ? (
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                      <span>{game.template_name}</span>
                      {game.scramble_seed ? (
                        <Chip tone="violet">scrambled · seed {game.scramble_seed}</Chip>
                      ) : (
                        <Chip tone="neutral">as published</Chip>
                      )}
                    </div>
                  ) : null}
                </div>
                <span className="text-muted" aria-hidden>
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <NewSessionSheet open={creating} onClose={() => setCreating(false)} />
    </main>
  );
}
