import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { APP, addDays, isWeekend, longDate, shortDate, today, weekdayName } from '../lib/config';
import { ChartIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon, RefreshIcon } from './icons';
import { Badge, Button, cx } from './ui';

export function BoardHeader({
  date,
  onDateChange,
  onAdd,
  onGraph,
  onRefresh,
  busy,
  identity,
  locked,
  canAdd = !locked,
  team,
}: {
  date: string;
  onDateChange: (date: string) => void;
  onAdd: () => void;
  onGraph: () => void;
  onRefresh: () => void;
  busy: boolean;
  identity: string | null;
  locked: boolean;
  canAdd?: boolean;
  /** The team's name (its manager), shown after the organisation. */
  team?: string | null;
}) {
  const root = useRef<HTMLElement>(null);
  const title = useRef<HTMLDivElement>(null);
  const t = today();
  const isToday = date === t;

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo('[data-head]', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.06, ease: 'power3.out' });
    }, root);
    return () => ctx.revert();
  }, []);

  useEffect(() => {
    if (title.current) gsap.fromTo(title.current, { opacity: 0, y: -5 }, { opacity: 1, y: 0, duration: 0.32, ease: 'power2.out' });
  }, [date]);

  return (
    <header ref={root} className="flex flex-col gap-3 border-b border-line pb-4 lg:flex-row lg:flex-nowrap lg:items-center lg:justify-between lg:gap-5">
      <div data-head className="flex min-w-0 items-center gap-x-3 overflow-hidden lg:flex-1">
        <span className="hidden shrink-0 text-[11px] leading-none font-semibold tracking-[0.14em] whitespace-nowrap text-ink-3 uppercase xl:inline">
          <span className="text-ink">{APP.org}</span>
          <span className="mx-2 text-line-strong">/</span>
          {team ?? APP.title}
        </span>
        <span className="hidden h-5 w-px shrink-0 bg-line-strong xl:block" />
        <div ref={title} className="flex min-w-0 items-center gap-x-2.5 overflow-hidden">
          <h1 className="shrink-0 text-[22px] leading-none font-bold tracking-[-0.03em] whitespace-nowrap text-ink sm:text-[26px] xl:text-[30px]">
            {weekdayName(date)}
          </h1>
          <p className="tnum hidden shrink-0 text-[14px] leading-none font-medium whitespace-nowrap text-ink-2 sm:block">{longDate(date)}</p>
          {isToday ? (
            <Badge tone="ok" dot>
              Today
            </Badge>
          ) : locked ? (
            <Badge tone="mute">Archive</Badge>
          ) : (
            <Badge tone="live">Open for backfill</Badge>
          )}
          {isWeekend(date) && (
            <span className="hidden shrink-0 xl:inline-flex">
              <Badge tone="mute">Weekend</Badge>
            </span>
          )}
          {locked && (
            <span className="shrink-0">
              <Badge tone="mute">View only</Badge>
            </span>
          )}
        </div>
      </div>
      <div data-head className="-mx-1 flex shrink-0 items-center gap-1.5 overflow-x-auto px-1 pb-1 lg:mx-0 lg:gap-2 lg:overflow-x-visible lg:px-0 lg:pb-0">
        <DayStepper date={date} onDateChange={onDateChange} />
        {!isToday && (
          <Button className="shrink-0" onClick={() => onDateChange(t)}>
            Today
          </Button>
        )}
        <Button size="icon" onClick={onRefresh} aria-label="Refresh" className="shrink-0">
          <RefreshIcon className={cx('size-4', busy && 'animate-spin')} />
        </Button>
        <Button className="shrink-0" onClick={onGraph}>
          <ChartIcon className="size-3.5" />
          Graph
        </Button>
        {canAdd && (
          <Button variant="primary" className="shrink-0" onClick={onAdd}>
            <PlusIcon className="size-3.5" />
            {identity ? 'Add entry' : 'Add your entry'}
          </Button>
        )}
      </div>
    </header>
  );
}

/** ‹ Today › — the next-day arrow stops at today. */
export function DayStepper({ date, onDateChange }: { date: string; onDateChange: (date: string) => void }) {
  const t = today();
  return (
    <div className="flex shrink-0 items-center rounded-sm border border-line-strong bg-surface">
      <button
        type="button"
        aria-label="Previous day"
        onClick={() => onDateChange(addDays(date, -1))}
        className="focus-ring flex h-9 w-9 items-center justify-center text-ink-3 transition-colors hover:bg-mute-bg hover:text-ink"
      >
        <ChevronLeftIcon className="size-4" />
      </button>
      <span className="tnum h-9 min-w-[76px] shrink-0 border-x border-line px-3 text-center text-[12.5px] leading-9 font-medium text-ink">
        {date === t ? 'Today' : shortDate(date)}
      </span>
      <button
        type="button"
        aria-label="Next day"
        disabled={date >= t}
        onClick={() => onDateChange(addDays(date, 1))}
        className={cx(
          'focus-ring flex h-9 w-9 items-center justify-center transition-colors',
          date >= t ? 'cursor-not-allowed text-ink-4/50' : 'text-ink-3 hover:bg-mute-bg hover:text-ink',
        )}
      >
        <ChevronRightIcon className="size-4" />
      </button>
    </div>
  );
}

export function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-line px-4 py-4 last:border-b-0">
          <div className="h-3 w-32 animate-pulse rounded-xs bg-mute-bg" />
          <div className="h-3 w-20 animate-pulse rounded-xs bg-mute-bg" />
          <div className="h-3 flex-1 animate-pulse rounded-xs bg-mute-bg" />
          <div className="h-3 w-16 animate-pulse rounded-xs bg-mute-bg" />
        </div>
      ))}
    </div>
  );
}
