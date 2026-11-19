import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-4 py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-lavender">Seven stocks. Seven hidden rules.</p>
      <h1 className="mt-3 text-4xl font-bold tracking-tight text-ink sm:text-5xl">Mystery Stock Market</h1>
      <p className="mt-4 max-w-xl text-muted">
        Every stock on this market moves according to a rule nobody has told you. Trade, watch, buy
        intelligence, hide what you are doing — and work out the mathematics before the others do.
      </p>

      <div className="mt-10 grid gap-3 sm:grid-cols-2">
        <Link href="/join" className="card group p-5 transition-colors hover:border-lavender/40">
          <div className="text-xs font-semibold uppercase tracking-wide text-lavender">I am playing</div>
          <div className="mt-1 text-lg font-semibold text-ink">Join a game</div>
          <p className="mt-1 text-sm text-muted">
            Enter the code your teacher gave you. Works on any phone.
          </p>
          <span className="mt-3 inline-block text-sm font-semibold text-lavender group-hover:underline">
            Enter game code →
          </span>
        </Link>

        <Link href="/admin" className="card group p-5 transition-colors hover:border-lavender/40">
          <div className="text-xs font-semibold uppercase tracking-wide text-lavender">I am running it</div>
          <div className="mt-1 text-lg font-semibold text-ink">Administrator</div>
          <p className="mt-1 text-sm text-muted">
            Create a session, check the rules, start the game and watch the market.
          </p>
          <span className="mt-3 inline-block text-sm font-semibold text-lavender group-hover:underline">
            Sign in →
          </span>
        </Link>
      </div>

      <p className="mt-10 text-xs text-muted">
        Inspired by Mystery Stock Market from The Devil&apos;s Plan, Season 3. Figures are in won and are
        entirely fictional.
      </p>
    </main>
  );
}
