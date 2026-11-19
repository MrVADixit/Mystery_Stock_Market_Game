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
