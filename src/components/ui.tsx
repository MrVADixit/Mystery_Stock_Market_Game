'use client';

import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';

/* ---------------------------------------------------------------- */
/* Primitives                                                        */
/* ---------------------------------------------------------------- */

export function Card({
  children,
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx('card p-4', className)} {...rest}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-lavender">{children}</h2>
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}

export function Chip({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'up' | 'down' | 'violet' | 'warn';
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-white/8 text-muted',
    up: 'bg-up/15 text-up',
    down: 'bg-down/15 text-down',
    violet: 'bg-violet/25 text-lavender',
    warn: 'bg-amber-400/15 text-amber-300',
  };
  return <span className={clsx('chip', tones[tone])}>{children}</span>;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Working"
      className={clsx(
        'inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent',
        className,
      )}
    />
  );
}

export function Tick({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className={clsx('h-4 w-4', className)}>
      <path
        d="M4 10.5l4 4 8-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Lock({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className={clsx('h-4 w-4', className)}>
      <rect x="4" y="9" width="12" height="8" rx="1.6" fill="currentColor" opacity="0.8" />
      <path d="M7 9V6.8a3 3 0 016 0V9" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

/* ---------------------------------------------------------------- */
/* Feedback                                                          */
/* ---------------------------------------------------------------- */

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: number;
  tone: ToastTone;
  text: string;
}

export function Toasts({ toasts, onDismiss }: { toasts: ToastMessage[]; onDismiss: (id: number) => void }) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => onDismiss(t.id)}
          className={clsx(
            'pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-lg px-4 py-3 text-left text-sm font-medium shadow-lg',
            t.tone === 'success' && 'bg-up/20 text-up ring-1 ring-up/40',
            t.tone === 'error' && 'bg-down/20 text-down ring-1 ring-down/40',
            t.tone === 'info' && 'bg-surface2 text-ink ring-1 ring-white/10',
          )}
        >
          {t.tone === 'success' ? <Tick /> : null}
          <span className="flex-1">{t.text}</span>
        </button>
      ))}
    </div>
  );
}

export function useToasts() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const next = useRef(1);

  function push(tone: ToastTone, text: string) {
    const id = next.current++;
    setToasts((all) => [...all, { id, tone, text }]);
    setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), tone === 'error' ? 6000 : 3000);
  }

  return {
    toasts,
    success: (t: string) => push('success', t),
    error: (t: string) => push('error', t),
    info: (t: string) => push('info', t),
    dismiss: (id: number) => setToasts((all) => all.filter((t) => t.id !== id)),
  };
}

/* ---------------------------------------------------------------- */
/* Overlays                                                          */
/* ---------------------------------------------------------------- */

export function Sheet({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center" role="dialog" aria-modal>
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
      />
      <div
        className={clsx(
          'relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl border border-white/8 bg-surface sm:rounded-2xl',
          wide ? 'sm:max-w-4xl' : 'sm:max-w-lg',
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          <button onClick={onClose} className="btn-ghost -mr-2 px-3" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Numbers                                                           */
/* ---------------------------------------------------------------- */

export function Stat({
  label,
  value,
  tone,
  small,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
  small?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={clsx('tabular font-semibold', small ? 'text-base' : 'text-xl', tone ?? 'text-ink')}>
        {value}
      </div>
    </div>
  );
}

/** A number input with − / + steppers, sized for thumbs. */
export function QuantityStepper({
  value,
  onChange,
  max,
  disabled,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  max?: number | null;
  disabled?: boolean;
  label: string;
}) {
  const clamp = (n: number) => {
    if (!Number.isFinite(n)) return 1;
    let next = Math.max(1, Math.floor(n));
    if (max != null && max >= 1) next = Math.min(next, max);
    return next;
  };

  return (
    <div className="flex items-stretch gap-1.5" role="group" aria-label={label}>
      <button
        type="button"
        className="btn-secondary w-11 px-0 text-lg"
        onClick={() => onChange(clamp(value - 1))}
        disabled={disabled || value <= 1}
        aria-label="Decrease quantity"
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        className="tabular field w-16 px-1 text-center font-semibold"
        aria-label={`${label} quantity`}
      />
      <button
        type="button"
        className="btn-secondary w-11 px-0 text-lg"
        onClick={() => onChange(clamp(value + 1))}
        disabled={disabled}
        aria-label="Increase quantity"
      >
        +
      </button>
    </div>
  );
}
