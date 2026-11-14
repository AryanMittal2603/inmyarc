type IconProps = { className?: string };

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
    </svg>
  );
}

export function ChevronLeftIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
    </svg>
  );
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
    </svg>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
    </svg>
  );
}

/** The brownie (cookie). */
export function CookieIcon({ className }: IconProps) {
  const d = 'M8 1.6a6.4 6.4 0 1 0 6.4 6.4 2.6 2.6 0 0 1-3.1-1.7 2.6 2.6 0 0 1-2.2-3.4A6.4 6.4 0 0 0 8 1.6Z';
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <path d={d} fill="currentColor" opacity=".16" />
      <path d={d} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <circle cx="6" cy="6.4" r="1" fill="currentColor" />
      <circle cx="9.4" cy="9.8" r="1" fill="currentColor" />
      <circle cx="5.5" cy="10.4" r=".85" fill="currentColor" />
    </svg>
  );
}

export function PaperclipIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <path
        d="M10.5 6.5l-4 4a1.75 1.75 0 0 0 2.5 2.5l4.5-4.5a3 3 0 0 0-4.25-4.25L4.5 9.25a4.25 4.25 0 0 0 6 6L13 12.75"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="square"
      />
    </svg>
  );
}

export function TrashIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8h6l.5-8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" />
    </svg>
  );
}

export function RefreshIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5V5h-2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" />
    </svg>
  );
}

export function CheckCircleIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 18 18" fill="none" className={className} aria-hidden>
      <circle cx="9" cy="9" r="7.25" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.75 9.25l2.2 2.2 4.3-4.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CrossCircleIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 18 18" fill="none" className={className} aria-hidden>
      <circle cx="9" cy="9" r="7.25" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6.6 6.6l4.8 4.8M11.4 6.6l-4.8 4.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function PencilIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <path d="M11.2 2.6l2.2 2.2L5.6 12.6l-3 .8.8-3 7.8-7.8z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

export function ChartIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <path d="M2.5 13.5h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" />
      <path d="M4.5 11.5v-4M8 11.5v-7M11.5 11.5v-2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
    </svg>
  );
}

export function DownloadIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <path d="M8 2v8m0 0L4.8 6.8M8 10l3.2-3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" />
      <path d="M2.5 12.5h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" />
    </svg>
  );
}
