import { useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import {
  BROWNIES,
  NEW_SYSTEM_START,
  STATUS_BY_KEY,
  VERDICTS,
  addMonths,
  brownieCount,
  formatMinutes,
  longDate,
  monthShort,
  monthStart,
  shortDate,
  timeOf,
  today,
  verdictOf,
} from '../lib/config';
import { formatBytes, openAttachment } from '../lib/files';
import { tally, verdictColor } from '../lib/review';
import type { Mark, Member } from '../lib/types';
import { useHistory } from '../hooks/useHistory';
import type { TeamScope } from '../lib/api';
import { ChevronLeftIcon, ChevronRightIcon, CookieIcon, PaperclipIcon } from './icons';
import { Badge, Modal, cx } from './ui';

function StatTile({ label, value, foot, tint }: { label: string; value: string; foot?: string; tint?: string }) {
  return (
    <div className="rounded-sm border border-line px-3 py-2.5" style={tint ? { backgroundColor: tint } : undefined}>
      <p className="text-[9.5px] font-semibold tracking-[0.1em] text-ink-3 uppercase">{label}</p>
      <p className="tnum mt-1 text-[19px] leading-none font-semibold tracking-[-0.02em] text-ink">{value}</p>
      {foot && <p className="mt-1 text-[10.5px] text-ink-4">{foot}</p>}
    </div>
  );
}

/** A member's record since the new system began: tiles, verdict mix, a month calendar and recent tasks. */
export function MemberStatsModal({
  member,
  onClose,
  markToday,
  team,
}: {
  member: Member;
  onClose: () => void;
  markToday: Mark | null;
  /** The member's team link name, or "*" (super admin). */
  team: TeamScope;
}) {
  const [month, setMonth] = useState(() => monthStart(today()));
  const [picked, setPicked] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const { rows, entries, loading } = useHistory(true, NEW_SYSTEM_START, team);

  const mine = useMemo(() => rows.filter((r) => r.member_id === member.id), [rows, member.id]);
  const myEntries = useMemo(() => entries.filter((e) => e.member_id === member.id), [entries, member.id]);
  const t = useMemo(() => tally(mine), [mine]);
  const byDay = useMemo(() => new Map(mine.map((r) => [r.log_date, r])), [mine]);

  const days = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const list: Array<{ date: string; row: (typeof mine)[number] | undefined }> = [];
    for (let d = 1; d <= count; d += 1) {
      const date = `${month.slice(0, 7)}-${String(d).padStart(2, '0')}`;
      if (date < NEW_SYSTEM_START || date > today()) continue;
      list.push({ date, row: byDay.get(date) });
    }
    return list;
  }, [month, byDay]);

  const dayTasks = useMemo(() => (picked ? myEntries.filter((e) => e.log_date === picked) : []), [picked, myEntries]);
  const recent = useMemo(() => [...myEntries].sort((a, b) => b.log_date.localeCompare(a.log_date)).slice(0, 8), [myEntries]);
  const best = useMemo(() => VERDICTS.find((v) => t.byCategory[v.key]) ?? null, [t]);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo('[data-cell]', { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 0.25, stagger: 0.01, ease: 'back.out(2)' });
    }, grid);
    return () => ctx.revert();
  }, [month, mine.length]);

  const todayVerdict = verdictOf(markToday?.category);
  const firstMonth = monthStart(NEW_SYSTEM_START);
  const thisMonth = monthStart(today());
  const list = picked ? dayTasks : recent;

  return (
    <Modal
      open
      onClose={onClose}
      title={member.name}
      subtitle={todayVerdict ? `Today — ${todayVerdict.label.toLowerCase()}` : 'Since the new system began on 1 October 2026'}
      width={900}
    >
      {loading ? (
        <div className="flex h-[320px] items-center justify-center text-[12.5px] text-ink-4">Loading…</div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" data-stagger>
            <StatTile label="Days judged" value={String(t.judged)} foot={`of ${t.days} logged`} />
            <StatTile label="Best verdict" value={best ? best.short : '—'} foot={best ? `${t.byCategory[best.key]} day(s)` : 'none yet'} tint={best?.bg} />
            <StatTile label="Brownies" value={String(t.brownies)} foot={BROWNIES.map((b) => `${t.byBrownie[b.key]} ${b.label.toLowerCase()}`).join(' · ')} />
            <StatTile label="Tasks" value={String(t.tasks)} foot={`${myEntries.filter((e) => e.status === 'done').length} done`} />
            <StatTile label="Time logged" value={formatMinutes(t.minutes)} />
          </div>

          <section data-stagger>
            <p className="mb-2 text-[11px] font-semibold tracking-[0.1em] text-ink-3 uppercase">How the days have been judged</p>
            <div className="flex flex-col gap-1.5">
              {VERDICTS.map((v) => {
                const n = t.byCategory[v.key];
                const pct = t.judged ? (100 * n) / t.judged : 0;
                return (
                  <div key={v.key} className="grid grid-cols-[132px_1fr_30px] items-center gap-3">
                    <span className="text-[11.5px] font-medium" style={{ color: v.ink }}>
                      {v.label}
                    </span>
                    <span className="h-[10px] overflow-hidden rounded-xs bg-mute-bg">
                      <span
                        className="block h-full rounded-xs"
                        style={{ width: `${pct}%`, backgroundColor: v.bg, borderRight: n ? `1px solid ${v.line}` : undefined }}
                      />
                    </span>
                    <span className="tnum text-right text-[11.5px] font-semibold text-ink-2">{n}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section data-stagger>
            <header className="mb-2 flex items-center gap-2">
              <button
                type="button"
                aria-label="Previous month"
                disabled={month <= firstMonth}
                onClick={() => {
                  setPicked(null);
                  setMonth(addMonths(month, -1));
                }}
                className={cx(
                  'focus-ring flex size-6 items-center justify-center rounded-xs',
                  month <= firstMonth ? 'cursor-not-allowed text-line-strong' : 'text-ink-3 hover:bg-mute-bg hover:text-ink',
                )}
              >
                <ChevronLeftIcon className="size-3.5" />
              </button>
              <span className="tnum min-w-[74px] text-center text-[12px] font-semibold text-ink">
                {monthShort(month)} {month.slice(0, 4)}
              </span>
              <button
                type="button"
                aria-label="Next month"
                disabled={month >= thisMonth}
                onClick={() => {
                  setPicked(null);
                  setMonth(addMonths(month, 1));
                }}
                className={cx(
                  'focus-ring flex size-6 items-center justify-center rounded-xs',
                  month >= thisMonth ? 'cursor-not-allowed text-line-strong' : 'text-ink-3 hover:bg-mute-bg hover:text-ink',
                )}
              >
                <ChevronRightIcon className="size-3.5" />
              </button>
              <span className="ml-auto text-[10.5px] text-ink-4">each square is a day, coloured by its verdict</span>
            </header>
            <div ref={grid} className="flex flex-wrap gap-1.5">
              {days.map(({ date, row }) => {
                const v = verdictOf(row?.mark?.category);
                const cookies = brownieCount(row?.mark);
                return (
                  <button
                    key={date}
                    data-cell
                    type="button"
                    disabled={!row}
                    onClick={() => setPicked(picked === date ? null : date)}
                    title={`${longDate(date)}${
                      row ? ` — ${row.tasks} task(s), ${formatMinutes(row.minutes)}${v ? `, ${v.label.toLowerCase()}` : ', not judged'}` : ' — nothing logged'
                    }`}
                    className={cx(
                      'flex size-[34px] flex-col items-center justify-center rounded-sm border text-[10px] font-semibold transition',
                      row ? 'cursor-pointer hover:scale-105' : 'opacity-55',
                      picked === date && 'ring-1 ring-ink',
                    )}
                    style={{ backgroundColor: verdictColor(row?.mark?.category ?? null), borderColor: v ? v.line : '#e5e5e1', color: v ? v.ink : '#78787f' }}
                  >
                    {date.slice(-2)}
                    {cookies > 0 && (
                      <span className="flex items-center gap-[1px] text-[8px]">
                        <CookieIcon className="size-[8px]" />
                        {cookies}
                      </span>
                    )}
                  </button>
                );
              })}
              {days.length === 0 && <p className="text-[12px] text-ink-4">Nothing in this month.</p>}
            </div>
          </section>

          <section data-stagger>
            <p className="mb-2 text-[11px] font-semibold tracking-[0.1em] text-ink-3 uppercase">{picked ? longDate(picked) : 'Recent tasks'}</p>
            <ul className="flex max-h-[220px] flex-col gap-1.5 overflow-y-auto pr-1">
              {list.map((e) => (
                <li key={e.id} className="rounded-sm border border-line bg-paper px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 text-[12.5px] leading-[1.45] font-medium break-words text-ink">{e.title}</p>
                    <span className="tnum shrink-0 text-[11.5px] text-ink-3">{picked ? formatMinutes(e.minutes) : shortDate(e.log_date)}</span>
                  </div>
                  {e.details && <p className="mt-1 text-[11.5px] leading-[1.5] break-words text-ink-2">{e.details}</p>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Badge tone={STATUS_BY_KEY[e.status].tone} dot>
                      {STATUS_BY_KEY[e.status].label}
                    </Badge>
                    {!picked && <span className="tnum text-[11px] text-ink-3">{formatMinutes(e.minutes)}</span>}
                    <span className="tnum text-[11px] text-ink-4">logged {timeOf(e.created_at)}</span>
                    {e.attachment_path && (
                      <button
                        type="button"
                        title={`Open ${e.attachment_name} (${formatBytes(e.attachment_size)})`}
                        onClick={() => openAttachment(e.id)}
                        className="focus-ring inline-flex max-w-[200px] items-center gap-1 rounded-xs text-[11px] font-medium text-ink-3 hover:text-ink"
                      >
                        <PaperclipIcon className="size-3 shrink-0" />
                        <span className="truncate underline decoration-line-strong underline-offset-2">{e.attachment_name}</span>
                      </button>
                    )}
                  </div>
                  {e.remarks && <p className="mt-1.5 border-l-2 border-line-strong pl-2 text-[11.5px] leading-[1.5] break-words text-ink-3">{e.remarks}</p>}
                </li>
              ))}
              {list.length === 0 && <p className="text-[12px] text-ink-4">Nothing logged.</p>}
            </ul>
          </section>
        </div>
      )}
    </Modal>
  );
}
