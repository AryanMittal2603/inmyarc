import { useEffect, useState, type ReactNode } from 'react';
import { CheckIcon, CopyIcon } from '../../components/icons';
import { Button, Input, Modal, cx } from '../../components/ui';

/** Readable, hard-to-guess password: three groups of four, no look-alike characters. */
export function generatePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)].map((g) => g.join('')).join('-');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

export function CopyButton({ text, label = 'Copy', compact = false }: { text: string; label?: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      size={compact ? 'icon-xs' : 'icon-sm'}
      variant="ghost"
      className="shrink-0"
      title={copied ? 'Copied' : label}
      aria-label={label}
      onClick={async () => setCopied(await copyText(text))}
    >
      {copied ? <CheckIcon className="size-3.5 text-ok" /> : <CopyIcon className="size-3.5" />}
      <span className="sr-only">{copied ? 'Copied' : label}</span>
    </Button>
  );
}

/** Password input with Show and Generate. Generated passwords are shown so they can be shared. */
export function PasswordField({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex gap-1.5">
      <Input
        id={id}
        type={visible ? 'text' : 'password'}
        autoComplete="new-password"
        value={value}
        placeholder="At least 8 characters"
        onChange={(e) => onChange(e.target.value)}
        className="tnum"
      />
      <Button className="shrink-0" onClick={() => setVisible((v) => !v)} aria-pressed={visible}>
        {visible ? 'Hide' : 'Show'}
      </Button>
      <Button
        className="shrink-0"
        onClick={() => {
          onChange(generatePassword());
          setVisible(true);
        }}
      >
        Generate
      </Button>
    </div>
  );
}

/** Bordered section with a title row, like the rest of the app. */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('rounded-md border border-line bg-surface', className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
          {description && <p className="mt-0.5 max-w-[72ch] text-[12.5px] leading-[1.5] text-ink-3">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function ConfirmModal({
  open,
  title,
  children,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setBusy(false);
      setError(null);
    }
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="border-off bg-off hover:border-off hover:bg-[#62262f]"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm();
                onClose();
              } catch (e) {
                setError(e instanceof Error ? e.message : 'That didn’t work.');
                setBusy(false);
              }
            }}
          >
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-[13px] leading-[1.55] text-ink-2">{children}</div>
      {error && (
        <p role="alert" className="mt-3 text-[12.5px] font-medium text-bad">
          {error}
        </p>
      )}
    </Modal>
  );
}

/** Small "label: value" line used for links and sign-in details. */
export function DetailLine({ label, value, copy = true }: { label: string; value: string; copy?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2 py-1">
      <span className="w-[104px] shrink-0 text-[12px] text-ink-3">{label}</span>
      <span className="tnum min-w-0 flex-1 truncate font-mono text-[12px] text-ink" title={value}>
        {value}
      </span>
      {copy && <CopyButton text={value} label={`Copy ${label.toLowerCase()}`} />}
    </div>
  );
}
