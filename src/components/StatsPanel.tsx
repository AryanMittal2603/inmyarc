import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import gsap from 'gsap';
import { dayTotals, type Group } from '../lib/board';
import { VERDICTS, formatMinutes } from '../lib/config';
import { cx } from './ui';

const TONE_TEXT = { ink: 'text-ink', ok: 'text-ok', bad: 'text-bad', wait: 'text-wait' } as const;

/** Big number that counts up to its new value. */
function CountUp({ value, text, tone = 'ink' }: { value?: number; text?: string; tone?: keyof typeof TONE_TEXT }) {
  const ref = useRef<HTMLSpanElement>(null);
  const last = useRef(0);
  useEffect(() => {
    if (value === undefined || !ref.current) return;
    const el = ref.current;
    const state = { n: last.current };
    last.current = value;
    const tween = gsap.to(state, {
      n: value,
      duration: 0.5,
      ease: 'power2.out',
      onUpdate: () => {
        el.textContent = String(Math.round(state.n));
      },
    });
    return () => {
      tween.kill();
    };
  }, [value]);
  return (
    <span ref={ref} className={cx('tnum text-[22px] leading-none font-semibold tracking-[-0.025em]', TONE_TEXT[tone])}>
      {text ?? 0}
    </span>
  );
}

function Tile({ label, children, foot }: { label: string; children: ReactNode; foot: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col justify-between gap-2.5 border-r border-b border-line px-4 py-3.5 last:border-r-0">
      <span className="truncate text-[10px] font-semibold tracking-[0.11em] text-ink-3 uppercase">{label}</span>
      <div className="flex items-baseline gap-1.5">{children}</div>
      <div className="h-[13px] text-[10.5px] leading-[13px] text-ink-4">{foot}</div>
    </div>
  );
}

export function StatsPanel({ groups }: { groups: Group[] }) {
  const t = useMemo(() => dayTotals(groups), [groups]);
  const bar = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (bar.current) gsap.to(bar.current, { width: `${t.pct}%`, duration: 0.6, ease: 'power3.out' });
  }, [t.pct]);

  return (
    <section className="overflow-hidden rounded-md border border-line bg-surface">
      {t.judged > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line bg-paper px-4 py-2">
          <span className="text-[10px] font-semibold tracking-[0.11em] text-ink-3 uppercase">Verdicts</span>
          {VERDICTS.map((v) => (
            <span key={v.key} className="flex items-center gap-1.5">
              <span className="size-[9px] rounded-[2px] border" style={{ backgroundColor: v.bg, borderColor: v.line }} />
              <span className="text-[11.5px] text-ink-3">{v.label}</span>
              <span className="tnum text-[12px] font-semibold" style={{ color: t.byCategory[v.key] ? v.ink : undefined }}>
                {t.byCategory[v.key]}
              </span>
            </span>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8">
        <div className="col-span-2 flex min-w-0 flex-col justify-between gap-2.5 border-r border-b border-line px-4 py-3.5 sm:col-span-1">
          <span className="truncate text-[10px] font-semibold tracking-[0.11em] text-ink-3 uppercase">Reported</span>
          <div className="flex items-baseline gap-1.5">
            <CountUp value={t.reported} />
            <span className="tnum text-[13px] font-medium text-ink-4">/ {t.total}</span>
          </div>
          <span className="block h-[13px] pt-[5px]">
            <span className="block h-[3px] w-full overflow-hidden bg-line">
              <span ref={bar} className="block h-full w-0 bg-ink" />
            </span>
          </span>
        </div>
        <Tile label="Working" foot={t.working ? `${t.att.full_day} full / ${t.att.wfh} wfh / ${t.att.half_day} half` : null}>
          <CountUp value={t.working} />
        </Tile>
        <Tile label="Off" foot={t.off ? `${t.att.week_off} week off / ${t.att.leave} leave` : null}>
          <CountUp value={t.off} />
        </Tile>
        <Tile label="Tasks" foot={t.tasks ? `${t.donePct}% done` : null}>
          <CountUp value={t.tasks} />
        </Tile>
        <Tile label="Done" foot={null}>
          <CountUp value={t.done} tone="ok" />
        </Tile>
        <Tile label="Open" foot={t.rework ? `${t.rework} need rework` : null}>
          <CountUp value={t.notDone} tone="bad" />
          {t.rework > 0 && <span className="tnum text-[13px] font-medium text-wait">+ {t.rework}</span>}
        </Tile>
        <Tile label="Time logged" foot={t.tasks ? `${t.tasks} tasks` : null}>
          <CountUp text={t.minutes ? formatMinutes(t.minutes) : '0m'} />
        </Tile>
        <Tile
          label="Judged"
          foot={t.brownies ? `${t.brownies} brownie${t.brownies === 1 ? '' : 's'} given` : t.judged ? 'verdicts in' : 'awaiting the manager'}
        >
          <CountUp value={t.judged} />
          <span className="tnum text-[13px] font-medium text-ink-4">/ {t.reported}</span>
        </Tile>
      </div>
    </section>
  );
}
