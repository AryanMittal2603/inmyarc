import { useEffect, useRef, useState, type ReactNode } from 'react';
import gsap from 'gsap';
import { errorText } from '../lib/api';
import { APP } from '../lib/config';
import { Button, FieldLabel, Input } from './ui';

/** Password card for the manager and super admin pages. The API sets an HttpOnly cookie on success. */
export function SignInCard({
  area,
  title,
  description,
  username,
  onSubmit,
  note,
  footer,
}: {
  /** Shown after the organisation name, e.g. "Ratings". */
  area: string;
  title: string;
  description: ReactNode;
  /** Helps password managers keep one password per team. */
  username: string;
  onSubmit: (password: string) => Promise<void>;
  note?: ReactNode;
  footer?: ReactNode;
}) {
  const card = useRef<HTMLFormElement>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (card.current) gsap.fromTo(card.current, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' });
  }, []);

  async function submit() {
    setError(null);
    if (!value) return setError('Enter the password.');
    setBusy(true);
    try {
      await onSubmit(value);
    } catch (e) {
      setError(errorText(e, 'Could not sign in.'));
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-5 py-10">
      <form
        ref={card}
        className="w-full max-w-[380px] rounded-md border border-line bg-surface p-6"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="mb-5 flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-ink-3 uppercase">
          <span className="text-ink">{APP.org}</span>
          <span className="text-line-strong">/</span>
          <span>{area}</span>
        </div>
        <h1 className="text-[20px] leading-tight font-bold tracking-[-0.02em] text-ink">{title}</h1>
        <p className="mt-1.5 mb-5 text-[12.5px] leading-[1.5] text-ink-3">{description}</p>
        {note}
        <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />
        <FieldLabel htmlFor="sign-in-password">Password</FieldLabel>
        <Input
          id="sign-in-password"
          type="password"
          autoComplete="current-password"
          value={value}
          placeholder="••••••••"
          onChange={(e) => setValue(e.target.value)}
        />
        {error && (
          <p role="alert" className="mt-2 text-[12px] font-medium text-bad">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" className="mt-4 w-full" disabled={busy}>
          {busy ? 'Checking…' : 'Sign in'}
        </Button>
        {footer && <div className="mt-3 text-center text-[12px] text-ink-3">{footer}</div>}
      </form>
    </div>
  );
}

/** A full-page message (unknown link, switched-off team…). */
export function PageMessage({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-5 py-10">
      <div className="w-full max-w-[420px] rounded-md border border-line bg-surface p-6">
        <div className="mb-5 text-[11px] font-semibold tracking-[0.14em] text-ink uppercase">{APP.org}</div>
        <h1 className="text-[20px] leading-tight font-bold tracking-[-0.02em] text-ink">{title}</h1>
        <div className="mt-1.5 text-[13px] leading-[1.55] text-ink-2">{children}</div>
        {action && <div className="mt-5 flex flex-wrap gap-2">{action}</div>}
      </div>
    </div>
  );
}

/** Link styled like a Button. */
export function ButtonLink({ href, children, primary = false }: { href: string; children: ReactNode; primary?: boolean }) {
  return (
    <a
      href={href}
      className={
        primary
          ? 'focus-ring inline-flex h-9 items-center justify-center gap-1.5 rounded-sm border border-ink bg-ink px-3.5 text-[13px] font-medium text-white transition-colors hover:border-ink-2 hover:bg-ink-2'
          : 'focus-ring inline-flex h-9 items-center justify-center gap-1.5 rounded-sm border border-line-strong bg-surface px-3.5 text-[13px] font-medium text-ink transition-colors hover:bg-mute-bg'
      }
    >
      {children}
    </a>
  );
}
