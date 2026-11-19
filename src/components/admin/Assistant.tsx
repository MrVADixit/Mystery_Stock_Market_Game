'use client';

import { useEffect, useState } from 'react';
import { Card, Chip, SectionTitle, Spinner } from '@/components/ui';
import { api } from '@/lib/client';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

interface Reply {
  configured: boolean;
  reply: string;
  reason?: string;
  calculations: { name: string; input: unknown; result: unknown }[];
}

const SUGGESTIONS = [
  'Explain what each of the seven rules does in one sentence.',
  'Would it be interesting to increase the holdings rule from 200 to 300 won per share?',
  'Which stock should use the scripted path, and why?',
  'Interpret my latest test report.',
  'Is this configuration likely to be too volatile for a classroom?',
];

/** The optional admin assistant (§16). The game never depends on it. */
export function Assistant({ gameId }: { gameId: string }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [reason, setReason] = useState<string | undefined>();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [calculations, setCalculations] = useState<Reply['calculations']>([]);

  useEffect(() => {
    api<{ configured: boolean; reason?: string }>(`/api/admin/games/${gameId}/ai`)
      .then((r) => {
        setConfigured(r.configured);
        setReason(r.reason);
      })
      .catch(() => setConfigured(false));
  }, [gameId]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    const next: Turn[] = [...turns, { role: 'user', content: message }];
    setTurns(next);
    setDraft('');
    setBusy(true);
    try {
      const reply = await api<Reply>(`/api/admin/games/${gameId}/ai`, {
        method: 'POST',
        body: JSON.stringify({ messages: next }),
      });
      setCalculations(reply.calculations);
      setTurns([
        ...next,
        {
          role: 'assistant',
          content: reply.reply || reply.reason || 'No answer came back.',
        },
      ]);
    } catch (e) {
      setTurns([
        ...next,
        { role: 'assistant', content: e instanceof Error ? e.message : 'The assistant is unavailable.' },
      ]);
    } finally {
      setBusy(false);
    }
  }

  if (configured === null) {
    return (
      <Card>
        <Spinner className="mr-2" /> Checking…
      </Card>
    );
  }

  if (!configured) {
    return (
      <Card>
        <SectionTitle hint="Optional">AI assistant — not configured</SectionTitle>
        <p className="text-sm text-muted">
          {reason ??
            'No ANTHROPIC_API_KEY is configured on this server, so the assistant is switched off.'}
        </p>
        <p className="mt-2 text-sm text-muted">
          Nothing else is affected. No price, rule, settlement, portfolio figure or leaderboard
          position in this game ever comes from a model — those are all computed by the rule engine.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle hint="Optional — it reads and calculates, it never changes a setting">
          AI assistant
        </SectionTitle>
        <p className="text-xs text-muted">
          The assistant can read this game&apos;s configuration and ask the engine to run the same
          readiness check, previews and simulations you can press yourself. Every number it quotes
          comes from one of those calls, and you make all the changes.
        </p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              className="rounded-full border border-white/12 px-2.5 py-1 text-[11px] text-muted hover:border-lavender/40 hover:text-ink"
              disabled={busy}
              onClick={() => void send(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </Card>

      {turns.length > 0 ? (
        <Card>
          <ul className="space-y-3">
            {turns.map((turn, i) => (
              <li key={i}>
                <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {turn.role === 'user' ? 'You' : 'Assistant'}
                </div>
                <p className="whitespace-pre-line text-sm text-ink/90">{turn.content}</p>
              </li>
            ))}
            {busy ? (
              <li className="text-sm text-muted">
                <Spinner className="mr-2" /> Thinking and running the engine…
              </li>
            ) : null}
          </ul>
        </Card>
      ) : null}

      {calculations.length > 0 ? (
        <Card>
          <SectionTitle hint="So you can check its figures">Engine calls it made</SectionTitle>
          <ul className="space-y-2">
            {calculations.map((c, i) => (
              <li key={i}>
                <details className="rounded-lg bg-surface2/40 p-2">
                  <summary className="cursor-pointer text-xs font-semibold text-lavender">
                    <Chip tone="up">calculated</Chip> {c.name}
                  </summary>
                  <pre className="mt-1.5 max-h-56 overflow-auto text-[10px] text-muted">
                    {JSON.stringify({ input: c.input, result: c.result }, null, 2)}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
          className="flex gap-2"
        >
          <input
            className="field"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask about a rule, a number, or a test result"
            maxLength={2000}
            disabled={busy}
          />
          <button className="btn-primary shrink-0" disabled={busy || !draft.trim()}>
            Send
          </button>
        </form>
      </Card>
    </div>
  );
}
