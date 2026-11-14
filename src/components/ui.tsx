import { useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import gsap from 'gsap';
import type { Tone } from '../lib/config';
import { ChevronDownIcon, CloseIcon } from './icons';

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

const TONES: Record<Tone, string> = {
  ok: 'bg-ok-bg text-ok',
  live: 'bg-live-bg text-live',
  wait: 'bg-wait-bg text-wait',
  off: 'bg-off-bg text-off',
  bad: 'bg-bad-bg text-bad',
  mute: 'bg-mute-bg text-ink-3',
};

export function Badge({ tone = 'mute', dot = false, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-xs px-1.5 py-0.5 text-[11px] leading-[16px] font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {dot && <span className="size-[5px] rounded-full bg-current opacity-70" />}
      {children}
    </span>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** icon sizes are square with no padding (padding classes can't be overridden reliably). */
  size?: 'sm' | 'md' | 'icon' | 'icon-sm' | 'icon-xs';
};

export function Button({ variant = 'secondary', size = 'md', className, type = 'button', ...rest }: ButtonProps) {
  const base =
    'focus-ring inline-flex items-center justify-center gap-1.5 rounded-sm border font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45';
  const sizes = {
    sm: 'h-7 px-2.5 text-[12px]',
    md: 'h-9 px-3.5 text-[13px]',
    icon: 'size-9 text-[13px]',
    'icon-sm': 'size-7 text-[12px]',
    'icon-xs': 'size-6 text-[12px]',
  }[size];
  const variants = {
    primary: 'border-ink bg-ink text-white hover:bg-ink-2 hover:border-ink-2 active:bg-ink',
    secondary: 'border-line-strong bg-surface text-ink hover:bg-mute-bg active:bg-line',
    ghost: 'border-transparent bg-transparent text-ink-3 hover:text-ink hover:bg-mute-bg',
    danger: 'border-transparent bg-transparent text-ink-3 hover:text-off hover:bg-off-bg',
  }[variant];
  return <button type={type} className={cx(base, sizes, variants, className)} {...rest} />;
}

export function FieldLabel({ children, hint, htmlFor }: { children: ReactNode; hint?: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline justify-between text-[11px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
      <span>{children}</span>
      {hint && <span className="font-normal tracking-normal normal-case text-ink-4">{hint}</span>}
    </label>
  );
}

const field =
  'focus-ring w-full rounded-sm border border-line-strong bg-surface px-2.5 text-[13px] text-ink placeholder:text-ink-4 transition-colors duration-150 hover:border-ink-4 focus-visible:border-ink';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(field, 'h-9', className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(field, 'resize-none py-2 leading-[1.5]', className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={cx(field, 'h-9 cursor-pointer appearance-none pr-8', className)} {...rest}>
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-ink-4" />
    </div>
  );
}

/** Row of toggle buttons (one pressed). */
export function Segmented<K extends string>({ value, onChange, options }: { value: K; onChange: (key: K) => void; options: ReadonlyArray<{ key: K; label: string }> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            aria-pressed={on}
            className={cx(
              'focus-ring rounded-sm border px-2.5 py-1.5 text-[12px] font-medium transition-colors duration-150',
              on ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink-2 hover:border-ink-4 hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Hours (0–24) and minutes (0–59), digits only. */
export function TimeInput({ hours, mins, onChange }: { hours: string; mins: string; onChange: (v: { hours?: string; mins?: string }) => void }) {
  const cls =
    'focus-ring tnum h-8 w-12 rounded-sm border border-line-strong bg-surface px-1.5 text-center text-[12.5px] text-ink placeholder:text-ink-4 hover:border-ink-4 focus-visible:border-ink';
  const clean = (raw: string, max: number) => {
    const digits = raw.replace(/[^0-9]/g, '').slice(0, 3);
    return digits === '' ? '' : String(Math.min(Number(digits), max));
  };
  return (
    <span className="inline-flex items-center gap-1">
      <input className={cls} inputMode="numeric" value={hours} aria-label="Hours taken" placeholder="0" onChange={(e) => onChange({ hours: clean(e.target.value, 24) })} />
      <span className="text-[11px] text-ink-4">h</span>
      <input className={cls} inputMode="numeric" value={mins} aria-label="Minutes taken" placeholder="00" onChange={(e) => onChange({ mins: clean(e.target.value, 59) })} />
      <span className="text-[11px] text-ink-4">m</span>
    </span>
  );
}

/** Minutes from the two time boxes; null when both are empty. Capped at 24h. */
export function toMinutes(hours: string, mins: string): number | null {
  const h = Number.parseInt(hours, 10);
  const m = Number.parseInt(mins, 10);
  if (!Number.isFinite(h) && !Number.isFinite(m)) return null;
  const total = (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  return Math.min(Math.max(total, 0), 1440);
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 640,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const backdrop = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !backdrop.current || !panel.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(backdrop.current, { opacity: 0 }, { opacity: 1, duration: 0.18, ease: 'power2.out' });
      gsap.fromTo(panel.current, { opacity: 0, y: 10, scale: 0.985 }, { opacity: 1, y: 0, scale: 1, duration: 0.28, ease: 'power3.out' });
      gsap.fromTo(
        panel.current!.querySelectorAll('[data-stagger]'),
        { opacity: 0, y: 6 },
        { opacity: 1, y: 0, duration: 0.26, stagger: 0.035, delay: 0.05, ease: 'power2.out' },
      );
    });
    panel.current.querySelector<HTMLElement>('input, select, textarea')?.focus();
    return () => ctx.revert();
  }, [open]);

  if (!open) return null;
  return (
    <div
      ref={backdrop}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/25 px-4 py-[6vh] backdrop-blur-[1px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ maxWidth: width }}
        className="w-full rounded-md border border-line-strong bg-surface shadow-[0_1px_2px_rgba(23,23,26,0.06),0_16px_40px_-12px_rgba(23,23,26,0.18)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[12px] text-ink-3">{subtitle}</p>}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close" className="-mt-0.5 -mr-1.5">
            <CloseIcon className="size-3.5" />
          </Button>
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 border-t border-line bg-paper px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}
