import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import gsap from 'gsap';
import { CheckCircleIcon, CookieIcon, CrossCircleIcon } from '../components/icons';
import { SetupNotice } from '../components/SetupNotice';
import { Badge, Segmented, cx } from '../components/ui';
import { ApiError, api, errorText } from '../lib/api';
import { APP, BROWNIES, VERDICTS, formatMinutes, longDate, today, weekdayName } from '../lib/config';
import { displayLink, links } from '../lib/routes';
import type { DayPulse, Status, TeamLink } from '../lib/types';

/*
 * The front door, built from the app's own pieces: its header, cards, tiles, table rows and badges.
 * The one new thing is "Today's arc": the working day as an arc, with every task logged today
 * across all teams placed at the time it was added. Live, and without names or titles.
 */

// Content never waits on an animation: none with reduced motion or in a background tab.
const skipMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.visibilityState !== 'visible';

type Load = { state: 'loading' } | { state: 'ready'; teams: TeamLink[]; pulse: DayPulse } | { state: 'setup' } | { state: 'error'; message: string };

const NO_PULSE: DayPulse = { tasks: 0, done: 0, rework: 0, notDone: 0, minutes: 0, times: [] };

const WRAP = 'mx-auto w-full max-w-[1240px] px-4 sm:px-8';
const PANEL = 'overflow-hidden rounded-md border border-line bg-surface';
const STRIP = 'flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-line bg-paper px-4 py-2';
const LABEL = 'text-[10.5px] font-semibold tracking-[0.12em] text-ink-3 uppercase';
const CRUMB = 'text-[11px] leading-none font-semibold tracking-[0.14em] whitespace-nowrap text-ink-3 uppercase';
const BTN = 'focus-ring inline-flex h-9 items-center justify-center gap-1.5 rounded-sm border px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-150';
const BTN_PRIMARY = cx(BTN, 'border-ink bg-ink text-white hover:border-ink-2 hover:bg-ink-2');
const BTN_SECONDARY = cx(BTN, 'border-line-strong bg-surface text-ink hover:bg-mute-bg');

const istMinutes = () => {
  const d = new Date();
  return (d.getUTCHours() * 60 + d.getUTCMinutes() + 330) % 1440; // India is always UTC+5:30
};
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function useIstMinutes(): number {
  const [m, setM] = useState(istMinutes);
  useEffect(() => {
    const id = window.setInterval(() => setM(istMinutes()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  return m;
}

/** Plays a small animation once, the first time the element is mostly on screen. */
function useReveal(build: (el: HTMLElement) => gsap.core.Timeline) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || skipMotion()) return;
    let tl: gsap.core.Timeline | null = null;
    const ctx = gsap.context(() => {
      tl = build(el);
    }, el);
    const io = new IntersectionObserver(
      (seen) => {
        if (seen.some((e) => e.isIntersecting)) {
          tl?.play();
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      ctx.revert();
    };
  }, []);
  return ref;
}

function progressText(team: TeamLink): string {
  if (team.members === 0) return 'No one on this team yet';
  if (team.reported === 0) return 'No one has logged yet today';
  if (team.reported >= team.members) return 'Everyone has logged today';
  return `${team.reported} of ${team.members} logged today`;
}

function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="4" fill="#17171a" />
      <path data-mark-line pathLength={1} d="M9 21.5 14 16l3.5 3.5L23 12" fill="none" stroke="#f6f6f4" strokeWidth="2.4" strokeLinecap="square" />
    </svg>
  );
}

/** A number that counts up from where it was, like the board's tiles. */
function CountUp({ value, format = String, className }: { value: number; format?: (n: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const last = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (skipMotion()) {
      el.textContent = format(value);
      last.current = value;
      return;
    }
    const state = { n: last.current };
    last.current = value;
    const tween = gsap.to(state, { n: value, duration: 0.8, ease: 'power2.out', onUpdate: () => void (el.textContent = format(Math.round(state.n))) });
    return () => void tween.kill();
  }, [value]);
  return (
    <span ref={ref} className={cx('tnum', className)}>
      {format(0)}
    </span>
  );
}

/* ───────────── today's arc ───────────── */

const DAY_START = 8 * 60;
const DAY_END = 22 * 60;
const CX = 300;
const CY = 282;
const R = 196;
const STATUS_INK: Record<Status, string> = { done: '#16704a', rework: '#8a5a08', not_done: '#b0242c' };
const STATUS_ORDER: Record<Status, number> = { done: 0, rework: 1, not_done: 2 };
const STATUS_LABEL: Record<Status, string> = { done: 'Done', rework: 'Rework', not_done: 'Not done' };

const clampDay = (m: number) => Math.min(DAY_END, Math.max(DAY_START, m));
const angleAt = (m: number) => Math.PI * (1 - (clampDay(m) - DAY_START) / (DAY_END - DAY_START));
const polar = (a: number, r: number) => [CX + r * Math.cos(a), CY - r * Math.sin(a)] as const;
function arcPath(m0: number, m1: number, r = R): string {
  const [x0, y0] = polar(angleAt(m0), r);
  const [x1, y1] = polar(angleAt(m1), r);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** One dot per task, stacked outward in 15-minute bins so busy stretches of the day stand out. */
function layoutDots(times: DayPulse['times']) {
  const bins = new Map<number, Status[]>();
  for (const [m, s] of times) {
    const bin = Math.floor(clampDay(m) / 15);
    const list = bins.get(bin) ?? [];
    list.push(s);
    bins.set(bin, list);
  }
  const dots: Array<{ key: string; x: number; y: number; s: Status }> = [];
  for (const [bin, list] of bins) {
    list.sort((a, b) => STATUS_ORDER[a] - STATUS_ORDER[b]);
    const a = angleAt(Math.min(DAY_END, bin * 15 + 7.5));
    const step = Math.min(7.5, 64 / list.length);
    list.forEach((s, k) => {
      const [x, y] = polar(a, R + 13 + k * step);
      dots.push({ key: `${bin}-${k}-${s}`, x, y, s });
    });
  }
  return dots;
}

function TodayArc({ load, className }: { load: Load; className?: string }) {
  const now = useIstMinutes();
  const pulse = load.state === 'ready' ? load.pulse : NO_PULSE;
  const dots = useMemo(() => layoutDots(pulse.times), [pulse.times]);
  const svg = useRef<SVGSVGElement>(null);
  const seen = useRef(new Set<string>());
  const inDay = now >= DAY_START && now <= DAY_END;
  const [nx, ny] = polar(angleAt(now), R);
  const first = pulse.times[0]?.[0];
  const latest = pulse.times[pulse.times.length - 1]?.[0];

  // New dots pop in; the ones already on the arc stay put.
  useLayoutEffect(() => {
    const el = svg.current;
    if (!el) return;
    const fresh = Array.from(el.querySelectorAll<SVGCircleElement>('[data-dot]')).filter((c) => !seen.current.has(c.dataset.dot ?? ''));
    fresh.forEach((c) => seen.current.add(c.dataset.dot ?? ''));
    if (!fresh.length || skipMotion()) return;
    const tween = gsap.fromTo(
      fresh,
      { scale: 0, opacity: 0, transformOrigin: '50% 50%' },
      { scale: 1, opacity: 1, duration: 0.45, ease: 'back.out(2.4)', stagger: Math.min(0.025, 1.2 / fresh.length), delay: 0.9 },
    );
    return () => void tween.kill();
  }, [dots]);

  const tasksLine =
    load.state !== 'ready' ? ' ' : pulse.tasks === 0 ? 'No tasks logged yet today' : `${pulse.tasks} ${pulse.tasks === 1 ? 'task' : 'tasks'} logged today`;
  const summary =
    pulse.tasks > 0 && first !== undefined && latest !== undefined
      ? `${pulse.tasks} tasks logged today between ${hhmm(first)} and ${hhmm(latest)}; it is ${hhmm(now)} India time.`
      : `No tasks logged yet today; it is ${hhmm(now)} India time.`;

  return (
    <section data-rise className={cx(PANEL, 'flex flex-col', className)} aria-labelledby="arc-title">
      <div className={STRIP}>
        <h2 id="arc-title" className={LABEL}>
          Today’s arc
        </h2>
        {load.state === 'ready' ? (
          <Badge tone="ok" dot>
            Live
          </Badge>
        ) : load.state === 'loading' ? null : (
          <Badge tone="mute">Not connected</Badge>
        )}
      </div>
      <div className="flex flex-1 items-end px-2 pt-3 sm:px-6 sm:pt-5">
        <svg ref={svg} viewBox="0 0 600 300" className="block w-full" role="img" aria-label={`Today’s arc: ${summary}`}>
          {/* hour ticks, labelled every two hours */}
          {Array.from({ length: (DAY_END - DAY_START) / 60 + 1 }, (_, i) => {
            const m = DAY_START + i * 60;
            const a = angleAt(m);
            const major = i % 2 === 0;
            const [x0, y0] = polar(a, R - (major ? 9 : 5));
            const [x1, y1] = polar(a, R - 1);
            const [lx, ly] = polar(a, R - 24);
            return (
              <g key={m}>
                <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={major ? '#a1a1a8' : '#d4d4cf'} strokeWidth={1.2} />
                {major && (
                  <text x={lx} y={ly + 4} textAnchor="middle" className="tnum fill-ink-4 text-[12px]">
                    {String(m / 60).padStart(2, '0')}
                  </text>
                )}
              </g>
            );
          })}
          <path d={arcPath(DAY_START, DAY_END)} fill="none" stroke="#e5e5e1" strokeWidth={2} />
          {now > DAY_START && <path data-elapsed pathLength={1} d={arcPath(DAY_START, now)} fill="none" stroke="#17171a" strokeWidth={2.6} strokeLinecap="round" />}
          {dots.map((d) => (
            <circle key={d.key} data-dot={d.key} cx={d.x} cy={d.y} r={3} fill={STATUS_INK[d.s]} />
          ))}
          {inDay && <circle cx={nx} cy={ny} r={5} className="fill-ink [transform-box:fill-box] [transform-origin:center] animate-[arc-pulse_2.4s_ease-out_infinite]" />}
          <circle data-now cx={nx} cy={ny} r={5.5} fill="#17171a" stroke="#fff" strokeWidth={2} />

          <text x={CX} y={CY - 66} textAnchor="middle" className="tnum fill-ink text-[54px] font-bold tracking-[-0.03em]">
            {hhmm(now).slice(0, 2)}
            <tspan className="animate-[arc-blink_1s_steps(1)_infinite]">:</tspan>
            {hhmm(now).slice(3)}
          </text>
          <text x={CX} y={CY - 38} textAnchor="middle" className="fill-ink-3 text-[11.5px] font-semibold tracking-[0.14em] uppercase">
            India time
          </text>
          <text x={CX} y={CY - 10} textAnchor="middle" className="fill-ink-2 text-[15px]">
            {tasksLine}
          </text>
        </svg>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-1.5 border-t border-line px-4 py-2.5 text-[12px] text-ink-3">
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {(['done', 'rework', 'not_done'] as const).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ backgroundColor: STATUS_INK[s] }} />
              {STATUS_LABEL[s]}
              <span className="tnum font-semibold text-ink">{s === 'done' ? pulse.done : s === 'rework' ? pulse.rework : pulse.notDone}</span>
            </span>
          ))}
        </span>
        <span>Each dot is a task, placed at the time it was added.</span>
      </div>
    </section>
  );
}

/* ───────────── today's numbers ───────────── */

function Tile({ label, children, foot }: { label: string; children: ReactNode; foot: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col justify-between gap-2.5 border-r border-b border-line px-4 py-3.5">
      <span className="truncate text-[10px] font-semibold tracking-[0.11em] text-ink-3 uppercase">{label}</span>
      <div className="flex items-baseline gap-1.5">{children}</div>
      <div className="h-[13px] truncate text-[10.5px] leading-[13px] text-ink-4">{foot}</div>
    </div>
  );
}

const NUM = 'text-[22px] leading-none font-semibold tracking-[-0.025em]';

function Numbers({ load }: { load: Load }) {
  const teams = load.state === 'ready' ? load.teams : [];
  const pulse = load.state === 'ready' ? load.pulse : NO_PULSE;
  const reported = teams.reduce((n, t) => n + t.reported, 0);
  const members = teams.reduce((n, t) => n + t.members, 0);
  const pct = members ? Math.round((100 * reported) / members) : 0;
  const donePct = pulse.tasks ? Math.round((100 * pulse.done) / pulse.tasks) : 0;
  const bar = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!bar.current) return;
    if (skipMotion()) bar.current.style.width = `${pct}%`;
    else gsap.to(bar.current, { width: `${pct}%`, duration: 0.8, ease: 'power3.out', delay: 0.2 });
  }, [pct]);

  return (
    <section data-rise className={PANEL} aria-label="Today’s numbers across all teams">
      <div className="-mr-px -mb-px grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        <Tile
          label="Reported"
          foot={
            <span className="mt-1 block h-[3px] w-full max-w-[140px] overflow-hidden rounded-full bg-mute-bg">
              <span ref={bar} className="block h-full w-0 rounded-full bg-ink" />
            </span>
          }
        >
          <CountUp value={reported} className={NUM} />
          <span className="tnum text-[13px] text-ink-4">/ {members}</span>
        </Tile>
        <Tile label="Teams" foot="each with its own board">
          <CountUp value={teams.length} className={NUM} />
        </Tile>
        <Tile label="Tasks" foot={pulse.tasks ? `${donePct}% done` : 'none yet today'}>
          <CountUp value={pulse.tasks} className={NUM} />
        </Tile>
        <Tile label="Done" foot="marked done">
          <CountUp value={pulse.done} className={cx(NUM, 'text-ok')} />
        </Tile>
        <Tile label="Open" foot={pulse.rework ? `${pulse.rework} need rework` : 'not done or rework'}>
          <CountUp value={pulse.notDone} className={cx(NUM, 'text-bad')} />
          {pulse.rework > 0 && <span className="tnum text-[13px] font-medium text-wait">+ {pulse.rework}</span>}
        </Tile>
        <Tile label="Time logged" foot={`${pulse.tasks} ${pulse.tasks === 1 ? 'task' : 'tasks'}`}>
          <CountUp value={pulse.minutes} format={formatMinutes} className={NUM} />
        </Tile>
      </div>
    </section>
  );
}

/* ───────────── the team list (the page's call to action) ───────────── */

function TeamRow({ team }: { team: TeamLink }) {
  const share = team.members ? Math.min(team.reported / team.members, 1) : 0;
  const board = links.board(team.slug);
  return (
    <li className="group relative grid grid-cols-1 gap-2.5 border-b border-line px-4 py-3.5 transition-colors last:border-b-0 hover:bg-[#fafaf9] sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_220px] sm:items-center sm:gap-6">
      <div className="min-w-0">
        <a
          href={board}
          className="focus-ring block truncate rounded-sm text-[15px] font-semibold tracking-[-0.01em] text-ink after:absolute after:inset-0 after:content-['']"
        >
          {team.name}
        </a>
        <span className="mt-0.5 block truncate text-[11.5px] text-ink-4">{displayLink(board)}</span>
      </div>
      <div className="flex min-w-0 items-center gap-3">
        <span className="h-[3px] w-20 shrink-0 overflow-hidden rounded-full bg-mute-bg" aria-hidden="true">
          <span data-meter className="block h-full rounded-full bg-ink" style={{ width: `${share * 100}%` }} />
        </span>
        <span className="truncate text-[12.5px] text-ink-2">{progressText(team)}</span>
      </div>
      <div className="flex items-center gap-4 sm:justify-end">
        <span aria-hidden="true" className={cx(BTN_SECONDARY, 'h-8 px-3 text-[12.5px] group-hover:border-ink group-hover:bg-ink group-hover:text-white')}>
          Open board
        </span>
        <a
          href={links.rating(team.slug)}
          className="focus-ring relative z-10 rounded-sm text-[12.5px] whitespace-nowrap text-ink-3 underline decoration-line-strong underline-offset-4 hover:text-ink hover:decoration-ink"
        >
          Manager sign-in
        </a>
      </div>
    </li>
  );
}

function Teams({ load, onRetry }: { load: Load; onRetry: () => void }) {
  const teams = load.state === 'ready' ? load.teams : [];
  const reported = teams.reduce((n, t) => n + t.reported, 0);
  const members = teams.reduce((n, t) => n + t.members, 0);

  let body: ReactNode;
  if (load.state === 'loading') {
    body = (
      <ul aria-label="Loading teams">
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex items-center gap-4 border-b border-line px-4 py-4 last:border-b-0">
            <div className="h-3 w-36 animate-pulse rounded-xs bg-mute-bg" />
            <div className="h-3 flex-1 animate-pulse rounded-xs bg-mute-bg" />
            <div className="h-3 w-20 animate-pulse rounded-xs bg-mute-bg" />
          </li>
        ))}
      </ul>
    );
  } else if (load.state === 'ready' && teams.length > 0) {
    body = (
      <>
        <div className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_220px] gap-6 border-b border-line px-4 py-2 sm:grid">
          <span className={LABEL}>Team</span>
          <span className={LABEL}>Today</span>
          <span />
        </div>
        <ul>
          {teams.map((team) => (
            <TeamRow key={team.slug} team={team} />
          ))}
        </ul>
      </>
    );
  } else if (load.state === 'ready') {
    body = (
      <div className="px-4 py-6">
        <p className="text-[15px] font-semibold text-ink">No teams yet</p>
        <p className="mt-1 max-w-[52ch] text-[13px] leading-[1.55] text-ink-3">
          The super admin creates each manager’s team and adds its people. Team links appear here as soon as they exist.
        </p>
        <a href="/admin" className={cx(BTN_PRIMARY, 'mt-4')}>
          Open super admin
        </a>
      </div>
    );
  } else if (load.state === 'error') {
    body = (
      <div className="px-4 py-6">
        <p className="text-[15px] font-semibold text-ink">The team list didn’t load</p>
        <p className="mt-1 max-w-[52ch] text-[13px] leading-[1.55] text-ink-3">{load.message}</p>
        <button type="button" onClick={onRetry} className={cx(BTN_SECONDARY, 'mt-4')}>
          Try again
        </button>
      </div>
    );
  } else {
    body = (
      <div className="p-4">
        <SetupNotice />
      </div>
    );
  }

  return (
    <section id="teams" data-rise className={cx(PANEL, 'scroll-mt-4')} aria-labelledby="teams-title">
      <div className={STRIP}>
        <h2 id="teams-title" className={LABEL}>
          Teams
        </h2>
        {load.state === 'ready' && members > 0 && (
          <span className="tnum text-[12px] text-ink-3">
            {reported} of {members} people have logged today
          </span>
        )}
      </div>
      {body}
    </section>
  );
}

/* ───────────── how it works: three small, true-to-life pieces of the app ───────────── */

function TaskMini() {
  const ref = useReveal((el) => {
    const tl = gsap.timeline({ paused: true, delay: 0.25 });
    gsap.set(el.querySelector('[data-before]'), { opacity: 1, y: 0 });
    gsap.set(el.querySelector('[data-after]'), { opacity: 0, y: 6 });
    gsap.set(el.querySelector('[data-cross]'), { opacity: 1 });
    gsap.set(el.querySelector('[data-check]'), { opacity: 0, scale: 0.5 });
    tl.to('[data-before]', { opacity: 0, y: -6, duration: 0.25, delay: 0.6 })
      .to('[data-after]', { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' }, '<0.1')
      .to('[data-cross]', { opacity: 0, duration: 0.2 }, '<')
      .to('[data-check]', { opacity: 1, scale: 1, duration: 0.4, ease: 'back.out(3)', transformOrigin: '50% 50%' }, '<');
    return tl;
  });
  return (
    <div ref={ref} className="overflow-hidden rounded-sm border border-line" aria-hidden="true">
      <div className="flex items-center gap-2.5 border-b border-line px-3 py-2.5">
        <span className="relative size-4 shrink-0">
          <span data-cross className="absolute inset-0 opacity-0">
            <CrossCircleIcon className="size-4 text-ink-4" />
          </span>
          <span data-check className="absolute inset-0">
            <CheckCircleIcon className="size-4 text-ok" />
          </span>
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">Exam-day monitoring</span>
        <span className="tnum text-[11.5px] text-ink-3">2h 30m</span>
        <span className="inline-grid justify-items-end">
          <span data-before className="col-start-1 row-start-1 opacity-0">
            <Badge tone="bad" dot>
              Not done
            </Badge>
          </span>
          <span data-after className="col-start-1 row-start-1">
            <Badge tone="ok" dot>
              Done
            </Badge>
          </span>
        </span>
      </div>
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <CheckCircleIcon className="size-4 shrink-0 text-ok" />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">Post-exam report</span>
        <span className="tnum text-[11.5px] text-ink-3">40m</span>
        <Badge tone="ok" dot>
          Done
        </Badge>
      </div>
    </div>
  );
}

function VerdictMini() {
  const pick = VERDICTS.find((v) => v.key === 'over_performed') ?? VERDICTS[1];
  const ref = useReveal((el) => {
    const tl = gsap.timeline({ paused: true, delay: 0.25 });
    const tags = el.querySelectorAll('[data-tag]');
    gsap.set(el.querySelector('[data-on]'), { opacity: 0 });
    gsap.set(el.querySelector('[data-brownie]'), { opacity: 0, scale: 0.6 });
    gsap.set(el.querySelector('[data-points]'), { opacity: 0, x: 6 });
    // the choice "walks" across the scale before it settles, like a manager weighing the day
    tl.to(tags, { borderColor: '#a1a1a8', duration: 0.12, stagger: 0.12, yoyo: true, repeat: 1 })
      .to('[data-on]', { opacity: 1, duration: 0.3 }, '-=0.2')
      .to('[data-brownie]', { opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(2.6)', transformOrigin: '0% 50%' }, '+=0.15')
      .to('[data-points]', { opacity: 1, x: 0, duration: 0.3 }, '<0.1');
    return tl;
  });
  return (
    <div ref={ref} className="rounded-sm border border-line px-3 py-3" aria-hidden="true">
      <div className="flex flex-wrap gap-1.5">
        {VERDICTS.map((v) => (
          <span key={v.key} className="relative inline-flex">
            <span data-tag className="rounded-xs border border-line bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink-4">
              {v.label}
            </span>
            {v.key === pick.key && (
              <span
                data-on
                className="absolute inset-0 rounded-xs border px-1.5 py-0.5 text-[11px] font-medium"
                style={{ borderColor: pick.ink, color: pick.ink, backgroundColor: '#fff' }}
              >
                {v.label}
              </span>
            )}
          </span>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5">
        <span data-brownie className="inline-flex items-center gap-1 rounded-xs border border-[#e7d3a6] bg-[#fbf3e1] px-1.5 py-0.5 text-[11px] font-medium text-[#7a5312]">
          <CookieIcon className="size-3" />
          Overtime
        </span>
        <span data-points className="tnum text-[11.5px] text-ink-3">
          4 + 1 = <span className="font-semibold text-ink">5 points</span>
        </span>
      </div>
    </div>
  );
}

// Two weeks of one person's points (verdict + brownies): a sample, rising.
const SAMPLE_POINTS = [3, 3, 4, 3, 4, 4, 5, 4, 5, 6];
const SAMPLE_DAYS = ['M', 'T', 'W', 'T', 'F', 'M', 'T', 'W', 'T', 'F'];

function ArcMini() {
  const W = 280;
  const H = 92;
  const pad = { l: 8, r: 12, t: 12, b: 20 };
  const xs = SAMPLE_POINTS.map((_, i) => pad.l + (i * (W - pad.l - pad.r)) / (SAMPLE_POINTS.length - 1));
  const ys = SAMPLE_POINTS.map((p) => pad.t + ((6 - p) / 5) * (H - pad.t - pad.b));
  // a smooth line through the points (Catmull-Rom as cubic Béziers)
  let d = `M ${xs[0]} ${ys[0]}`;
  for (let i = 0; i < xs.length - 1; i++) {
    const [x0, y0] = [xs[Math.max(0, i - 1)], ys[Math.max(0, i - 1)]];
    const [x1, y1] = [xs[i], ys[i]];
    const [x2, y2] = [xs[i + 1], ys[i + 1]];
    const [x3, y3] = [xs[Math.min(xs.length - 1, i + 2)], ys[Math.min(xs.length - 1, i + 2)]];
    d += ` C ${(x1 + (x2 - x0) / 6).toFixed(1)} ${(y1 + (y2 - y0) / 6).toFixed(1)}, ${(x2 - (x3 - x1) / 6).toFixed(1)} ${(y2 - (y3 - y1) / 6).toFixed(1)}, ${x2} ${y2}`;
  }
  const ref = useReveal((el) => {
    const tl = gsap.timeline({ paused: true, delay: 0.2 });
    gsap.set(el.querySelector('[data-line]'), { strokeDasharray: 1, strokeDashoffset: 1 });
    gsap.set(el.querySelectorAll('[data-pt]'), { scale: 0, transformOrigin: '50% 50%' });
    tl.to('[data-line]', { strokeDashoffset: 0, duration: 1.4, ease: 'power2.inOut' }).to(
      '[data-pt]',
      { scale: 1, duration: 0.3, ease: 'back.out(3)', stagger: 0.12 },
      0.05,
    );
    return tl;
  });
  return (
    <div ref={ref} className="rounded-sm border border-line px-3 pt-3 pb-2" aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full">
        {[1, 3, 5].map((p) => {
          const y = pad.t + ((6 - p) / 5) * (H - pad.t - pad.b);
          return <line key={p} x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="#f0f0ed" strokeWidth={1} />;
        })}
        <path data-line pathLength={1} d={d} fill="none" stroke="#17171a" strokeWidth={2} strokeLinecap="round" />
        {xs.map((x, i) => (
          <circle key={i} data-pt cx={x} cy={ys[i]} r={i === xs.length - 1 ? 3.6 : 2.6} fill={i === xs.length - 1 ? '#17171a' : '#fff'} stroke="#17171a" strokeWidth={1.4} />
        ))}
        {SAMPLE_DAYS.map((day, i) => (
          <text key={i} x={xs[i]} y={H - 5} textAnchor="middle" className="fill-ink-4 text-[8.5px]">
            {day}
          </text>
        ))}
      </svg>
      <div className="mt-1 flex items-center justify-between text-[10.5px] text-ink-4">
        <span>Points per day, two weeks</span>
        <span>Sample</span>
      </div>
    </div>
  );
}

function StepCard({ step, area, title, children, mini }: { step: number; area: string; title: string; children: ReactNode; mini: ReactNode }) {
  return (
    <div className="flex flex-col rounded-md border border-line bg-surface p-5 sm:p-6">
      <span className={CRUMB}>
        <span className="text-ink">Step {step}</span>
        <span className="mx-2 text-line-strong">/</span>
        {area}
      </span>
      <h3 className="mt-4 text-[18px] leading-tight font-bold tracking-[-0.02em] text-ink">{title}</h3>
      <p className="mt-1.5 text-[13px] leading-[1.55] text-ink-3">{children}</p>
      <div className="mt-auto pt-5">{mini}</div>
    </div>
  );
}

/* ───────────── inside the app: real screenshots of a sample team ───────────── */

type View = 'board' | 'graph';
const VIEWS: Record<View, { label: string; caption: string; alt: string; files: [string, string]; height: number }> = {
  board: {
    label: 'Team board',
    caption: 'A team’s board at the end of a Tuesday: everyone’s tasks, time and attendance, ranked by the verdict their manager gave the day.',
    alt: 'A team board for Tuesday 10 November: nine people with their tasks, times, statuses and the manager’s verdict for each day.',
    files: ['board-1280.webp', 'board-2560.webp'],
    height: 1636,
  },
  graph: {
    label: 'Graph',
    caption: 'The Graph after four weeks: everyone’s verdicts as one bar, best first, and the team’s mix week by week.',
    alt: 'The Graph for a team over four weeks: each person’s verdicts as a coloured bar, ranked, with the team’s verdicts week by week below.',
    files: ['graph-978.webp', 'graph-1956.webp'],
    height: 1217,
  },
};

function Inside() {
  const [view, setView] = useState<View>('board');
  return (
    <section className={PANEL} aria-labelledby="inside-title">
      <div className={cx(STRIP, 'py-2.5')}>
        <h2 id="inside-title" className={LABEL}>
          Inside In my arc
        </h2>
        <div className="flex items-center gap-3">
          <span className="hidden text-[11.5px] text-ink-4 sm:inline">Sample data</span>
          <Segmented value={view} onChange={setView} options={(['board', 'graph'] as const).map((k) => ({ key: k, label: VIEWS[k].label }))} />
        </div>
      </div>
      <div className="relative aspect-square overflow-hidden bg-paper sm:aspect-[2560/1636]">
        {(['board', 'graph'] as const).map((k) => {
          const v = VIEWS[k];
          const [small, large] = v.files;
          const w = Number(large.match(/(\d+)\.webp$/)?.[1] ?? 0);
          return (
            <img
              key={k}
              src={`/home/${small}`}
              srcSet={`/home/${small} ${w / 2}w, /home/${large} ${w}w`}
              sizes="(min-width: 1240px) 1176px, (min-width: 640px) calc(100vw - 64px), 160vw"
              width={w}
              height={v.height}
              alt={view === k ? v.alt : ''}
              aria-hidden={view !== k}
              decoding="async"
              className={cx(
                'absolute inset-0 h-full w-full object-left-top transition-[opacity,transform] duration-500 ease-out',
                k === 'board' ? 'object-cover [mask-image:linear-gradient(to_bottom,#000_78%,transparent)]' : 'bg-surface object-cover sm:object-contain sm:object-top',
                view === k ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
              )}
            />
          );
        })}
      </div>
      <p className="border-t border-line px-4 py-2.5 text-[12.5px] leading-[1.5] text-ink-3">{VIEWS[view].caption}</p>
    </section>
  );
}

/* ───────────── verdicts and questions ───────────── */

function Verdicts() {
  return (
    <section className={PANEL} aria-labelledby="verdicts-title">
      <div className={STRIP}>
        <h2 id="verdicts-title" className={LABEL}>
          Verdicts and points
        </h2>
        <span className="text-[11.5px] text-ink-4">one per person per day</span>
      </div>
      <table className="w-full border-collapse text-left">
        <tbody>
          {VERDICTS.map((v) => (
            <tr key={v.key} className="border-b border-line">
              <th scope="row" className="px-4 py-2.5 font-normal">
                <span className="inline-flex rounded-xs border bg-surface px-1.5 py-0.5 text-[12px] font-medium" style={{ borderColor: v.line, color: v.ink }}>
                  {v.label}
                </span>
              </th>
              <td className="tnum px-4 py-2.5 text-right text-[12.5px] text-ink-2">
                {v.points} {v.points === 1 ? 'point' : 'points'}
              </td>
            </tr>
          ))}
          {BROWNIES.map((b) => (
            <tr key={b.key} className="border-b border-line last:border-b-0">
              <th scope="row" className="px-4 py-2.5 font-normal">
                <span className="inline-flex items-center gap-1 rounded-xs border border-[#e7d3a6] bg-[#fbf3e1] px-1.5 py-0.5 text-[12px] font-medium text-[#7a5312]">
                  <CookieIcon className="size-3" />
                  {b.label}
                </span>
                <span className="mt-0.5 block text-[12px] text-ink-4 sm:mt-0 sm:ml-2.5 sm:inline">{b.hint}</span>
              </th>
              <td className="tnum px-4 py-2.5 text-right text-[12.5px] text-ink-2">+1</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const QUESTIONS: Array<{ q: string; a: string }> = [
  { q: 'Do I need an account?', a: 'No. Open your team’s board, pick your name and add your tasks. Your browser remembers your name for next time.' },
  {
    q: 'Can I fill in a day I missed?',
    a: 'Boards are open for today. The super admin can open a few recent days for catching up, and your manager can add or fix any day for you.',
  },
  {
    q: 'Why does the rating page ask for the password every time?',
    a: 'Sign-ins aren’t remembered, so a shared computer never stays signed in. Managers and the super admin enter it on every visit, a reload included.',
  },
  { q: 'Can I attach a file to a task?', a: 'Yes, one file per task, up to 10 MB.' },
  { q: 'When does the day change?', a: 'At midnight India time (IST), wherever you are.' },
];

function Questions() {
  return (
    <section className={PANEL} aria-labelledby="questions-title">
      <div className={STRIP}>
        <h2 id="questions-title" className={LABEL}>
          Questions
        </h2>
      </div>
      <dl>
        {QUESTIONS.map((item) => (
          <div key={item.q} className="border-b border-line px-4 py-3 last:border-b-0">
            <dt className="text-[13.5px] font-semibold text-ink">{item.q}</dt>
            <dd className="mt-0.5 text-[13px] leading-[1.55] text-ink-3">{item.a}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ───────────── page ───────────── */

export function Home() {
  const root = useRef<HTMLDivElement>(null);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const t = today();

  const fetchTeams = useCallback(async (quiet = false) => {
    if (!quiet) setLoad({ state: 'loading' });
    try {
      const res = await api.teams();
      setLoad({ state: 'ready', teams: res.teams, pulse: res.pulse ?? NO_PULSE });
    } catch (error) {
      if (quiet) return; // keep what's on screen; the next refresh will try again
      if (error instanceof ApiError && error.code === 'no_database') setLoad({ state: 'setup' });
      else setLoad({ state: 'error', message: errorText(error, 'Something went wrong.') });
    }
  }, []);

  useEffect(() => {
    document.title = `In my arc — ${APP.org} daily log`;
    void fetchTeams();
    // the arc is live: new tasks appear without a reload
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void fetchTeams(true);
    }, 120_000);
    return () => window.clearInterval(id);
  }, [fetchTeams]);

  // One entrance, the board's own: pieces rise into place, the mark draws its line, the day's arc draws up to now.
  useLayoutEffect(() => {
    if (skipMotion() || !root.current) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.fromTo('[data-rise]', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.06 })
        .fromTo('[data-mark-line]', { strokeDasharray: 1, strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.7, ease: 'power2.inOut' }, 0.1)
        .fromTo('[data-now]', { scale: 0, transformOrigin: '50% 50%' }, { scale: 1, duration: 0.4, ease: 'back.out(3)' }, 1.4);
      // before 08:00 there is no elapsed stretch to draw
      if (root.current?.querySelector('[data-elapsed]')) {
        tl.fromTo('[data-elapsed]', { strokeDasharray: 1, strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1.3, ease: 'power2.inOut' }, 0.25);
      }
    }, root);
    return () => ctx.revert();
  }, []);

  // Each team's meter fills once the real numbers arrive.
  const ready = load.state === 'ready';
  useLayoutEffect(() => {
    if (!ready || skipMotion() || !root.current) return;
    const ctx = gsap.context(() => {
      gsap.from('[data-meter]', { width: 0, duration: 0.9, ease: 'power2.out', stagger: 0.05, delay: 0.3 });
    }, root);
    return () => ctx.revert();
  }, [ready]);

  return (
    <div ref={root} className="home min-h-screen overflow-x-clip bg-paper font-sans text-ink">
      <header className={cx(WRAP, 'pt-5 sm:pt-6')}>
        <div className="flex flex-col gap-3 border-b border-line pb-4 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
          <div data-rise className="flex min-w-0 items-center gap-x-3">
            <a href="/" aria-label="In my arc, home" className="focus-ring shrink-0 rounded-sm">
              <Mark className="size-7" />
            </a>
            <span className={cx(CRUMB, 'hidden lg:inline')}>
              <span className="text-ink">{APP.org}</span>
              <span className="mx-2 text-line-strong">/</span>
              In my arc
            </span>
            <span className="hidden h-5 w-px shrink-0 bg-line-strong lg:block" />
            <div className="flex min-w-0 items-center gap-x-2.5">
              <p className="shrink-0 text-[22px] leading-none font-bold tracking-[-0.03em] text-ink sm:text-[26px] xl:text-[30px]">{weekdayName(t)}</p>
              <p className="tnum hidden shrink-0 text-[14px] leading-none font-medium whitespace-nowrap text-ink-2 sm:block">{longDate(t)}</p>
              <Badge tone="ok" dot>
                Today
              </Badge>
            </div>
          </div>
          <div data-rise className="flex shrink-0 items-center gap-2">
            <a href="/admin" className={BTN_SECONDARY}>
              Super admin
            </a>
            <a href="#teams" className={BTN_PRIMARY}>
              Find your team
            </a>
          </div>
        </div>
      </header>

      <main className={cx(WRAP, 'mt-5 flex flex-col gap-4 sm:mt-6')}>
        <div className="grid gap-4 lg:grid-cols-12">
          <div data-rise className="flex flex-col rounded-md border border-line bg-surface p-6 sm:p-8 lg:col-span-5">
            <span className={CRUMB}>
              <span className="text-ink">{APP.org}</span>
              <span className="mx-2 text-line-strong">/</span>
              Daily log
            </span>
            <h1 className="mt-6 text-[32px] leading-[1.06] font-bold tracking-[-0.03em] text-balance text-ink sm:text-[40px]">What did you work on today?</h1>
            <p className="mt-3 max-w-[44ch] text-[14px] leading-[1.6] text-ink-3">
              Log your tasks, the time they took and your attendance on your team’s board. Your manager rates the day, and over the weeks the ratings
              trace your arc.
            </p>
            <div className="mt-auto pt-8">
              <a href="#teams" className={cx(BTN_PRIMARY, 'h-11 w-full text-[14px]')}>
                Find your team
              </a>
              <a href="#how" className="focus-ring mx-auto mt-3 block w-fit rounded-sm text-center text-[13px] text-ink-3 hover:text-ink">
                How it works
              </a>
            </div>
          </div>
          <TodayArc load={load} className="lg:col-span-7" />
        </div>

        {(load.state === 'ready' || load.state === 'loading') && <Numbers load={load} />}
        <Teams load={load} onRetry={() => void fetchTeams()} />

        <section id="how" className="mt-6 scroll-mt-4" aria-labelledby="how-title">
          <h2 id="how-title" className={cx(LABEL, 'mb-3 px-1')}>
            How it works
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            <StepCard step={1} area="Log" title="Add your day" mini={<TaskMini />}>
              Open your team’s board, pick your name and add each task with its time and status. Mark the day as full day, half day, WFH, leave or
              week off.
            </StepCard>
            <StepCard step={2} area="Rate" title="Your manager rates it" mini={<VerdictMini />}>
              One verdict for the whole day, plus a brownie for overtime, a holiday worked or pulling the team out of trouble.
            </StepCard>
            <StepCard step={3} area="Track" title="Watch your arc" mini={<ArcMini />}>
              Points add up by week and month on the Graph, open on every board, so everyone can see how their days are going.
            </StepCard>
          </div>
        </section>

        <div className="mt-6">
          <Inside />
        </div>

        <div className="grid gap-4 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <Verdicts />
          </div>
          <div className="lg:col-span-7">
            <Questions />
          </div>
        </div>
      </main>

      <footer className={cx(WRAP, 'mt-8 pb-8')}>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line pt-5 text-[11.5px] text-ink-4">
          <span>{APP.org} internal · all times Asia/Kolkata</span>
          <span className="flex items-center gap-4">
            <a href="#teams" className="focus-ring rounded-sm hover:text-ink">
              All teams
            </a>
            <a href="/admin" className="focus-ring rounded-sm hover:text-ink">
              Super admin
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
