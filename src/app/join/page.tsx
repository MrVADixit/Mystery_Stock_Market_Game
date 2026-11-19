'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/client';
import { Spinner } from '@/components/ui';

function JoinForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [joinCode, setJoinCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A QR code or a shared link can carry the code already.
  useEffect(() => {
    const code = params.get('code');
    if (code) setJoinCode(code.toUpperCase());
  }, [params]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api<{ gameId: string; reconnected: boolean }>('/api/join', {
        method: 'POST',
        body: JSON.stringify({ joinCode: joinCode.trim(), displayName, passphrase }),
      });
      router.push('/play');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join.');
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <Link href="/" className="mb-6 text-xs font-semibold uppercase tracking-[0.2em] text-muted hover:text-ink">
        ← Mystery Stock Market
      </Link>
      <h1 className="text-2xl font-bold text-ink">Join the game</h1>
      <p className="mt-1 text-sm text-muted">
        Already registered? Enter the same name and passphrase to pick up exactly where you left off.
      </p>

      <form onSubmit={submit} className="card mt-6 space-y-4 p-5">
        <div>
          <label className="label" htmlFor="code">
            Game code
          </label>
          <input
            id="code"
            className="field tabular text-center text-2xl font-bold uppercase tracking-[0.3em]"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={16}
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="name">
            Your display name
          </label>
          <input
            id="name"
            className="field"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="How you appear on the leaderboard"
            autoComplete="nickname"
            maxLength={24}
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="pass">
            Passphrase
          </label>
          <input
            id="pass"
            className="field"
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="At least 4 characters"
            autoComplete="current-password"
            minLength={4}
            required
          />
          <p className="mt-1.5 text-xs text-muted">
            This is how you get back in if your connection drops. Pick something you will remember.
          </p>
        </div>

        {error ? (
          <p role="alert" className="rounded-lg bg-down/15 px-3 py-2 text-sm text-down">
            {error}
          </p>
        ) : null}

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? <Spinner /> : null}
          {busy ? 'Joining…' : 'Join game'}
        </button>
      </form>
    </main>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={<main className="p-8 text-muted">Loading…</main>}>
      <JoinForm />
    </Suspense>
  );
}
