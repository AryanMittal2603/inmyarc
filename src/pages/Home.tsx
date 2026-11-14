import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import gsap from 'gsap';
import { SetupNotice } from '../components/SetupNotice';
import { cx } from '../components/ui';
import { ApiError, api, errorText } from '../lib/api';
import { APP, BROWNIES, VERDICTS, longDate, today, weekdayName } from '../lib/config';
import { displayLink, links } from '../lib/routes';
import type { TeamLink } from '../lib/types';

/*
 * The front door: what the daily log is, how it works, and every team's links.
 * Light and airy, indigo accents, a few floating product cards. No pricing: it's an internal tool.
 */

const INDIGO = '#3f3cf0';
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type Load = { state: 'loading' } | { state: 'ready'; teams: TeamLink[] } | { state: 'setup' } | { state: 'error'; message: string };

const CARD =
  'rounded-[20px] border border-[#e9eaf3] bg-white shadow-[0_1px_2px_rgba(16,18,40,0.04),0_22px_44px_-22px_rgba(16,18,40,0.22)]';
const PILL = 'inline-flex items-center gap-1.5 rounded-full border border-[#e3e5ef] bg-white px-3 py-1 text-[12.5px] font-medium text-[#4a4e63]';
const BTN_PRIMARY =
  'home-focus inline-flex h-11 items-center justify-center gap-2 rounded-[11px] bg-[#3f3cf0] px-5 text-[14.5px] font-semibold text-white shadow-[0_8px_18px_-8px_rgba(63,60,240,0.7)] transition-colors duration-150 hover:bg-[#3431d8]';
const BTN_SECONDARY =
  'home-focus inline-flex h-11 items-center justify-center gap-2 rounded-[11px] border border-[#e1e3ee] bg-white px-5 text-[14.5px] font-semibold text-[#14152a] transition-colors duration-150 hover:border-[#c6c9da]';

const AVATAR_COLORS = ['#3f3cf0', '#e8590c', '#0f9d76', '#c2255c', '#1971c2', '#7048e8'];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function colorFor(key: string): string {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function progressText(team: TeamLink): string {
  if (team.members === 0) return 'No one on this team yet';
  if (team.reported === 0) return 'No one has logged yet today';
  if (team.reported >= team.members) return 'Everyone has logged today';
  return `${team.reported} of ${team.members} logged today`;
}

/* ───────────── small pieces ───────────── */

function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill={INDIGO} />
        <path d="M8.5 21.5a8 8 0 0 1 15 0" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="21.6" cy="14.4" r="2.4" fill="#ffd166" />
      </svg>
      <span className="text-[16px] font-bold tracking-[-0.02em] text-[#0e0f1a]">In my arc</span>
    </span>
  );
}

function Check({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-[15px] leading-[1.5] text-[#2b2e42]">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-[8px] bg-[#eceafe] text-[#3f3cf0]" aria-hidden="true">
        <svg viewBox="0 0 16 16" className="size-3.5">
          <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {children}
    </li>
  );
}

function SectionPill({ children }: { children: ReactNode }) {
  return <span className={PILL}>{children}</span>;
}

/* ───────────── hero cards (product previews) ───────────── */

const STATUS_CHIP = {
  done: 'bg-[#e7f5ee] text-[#16704a]',
  rework: 'bg-[#fbf1df] text-[#8a5a08]',
  open: 'bg-[#fdeaea] text-[#b0242c]',
} as const;

function DayCard() {
  const t = today();
  const tasks: Array<{ title: string; time: string; status: keyof typeof STATUS_CHIP; label: string }> = [
    { title: 'Exam monitoring', time: '1h 30m', status: 'done', label: 'Done' },
    { title: 'Candidate mapping', time: '45m', status: 'rework', label: 'Rework' },
    { title: 'Post-exam report', time: '30m', status: 'open', label: 'Not done' },
  ];
  return (
    <div data-hero-card data-tilt="-3" className={cx(CARD, 'w-full max-w-[320px] p-5 text-left')}>
      <div className="flex items-start gap-3">
        <div className="w-11 shrink-0 overflow-hidden rounded-[9px] border border-[#ecedf4] text-center">
          <div className="bg-[#e5484d] py-[2px] text-[9.5px] font-bold tracking-[0.06em] text-white">{weekdayName(t).slice(0, 3).toUpperCase()}</div>
          <div className="py-1 text-[17px] leading-none font-bold text-[#0e0f1a]">{Number(t.slice(8))}</div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] font-semibold text-[#0e0f1a]">Your day</p>
          <p className="text-[12.5px] text-[#80849a]">Work from home</p>
        </div>
        <span className="rounded-full border border-[#e6e7f0] px-2 py-0.5 text-[11.5px] font-medium text-[#4a4e63]">2h 45m</span>
      </div>
      <div className="mt-5 flex items-center justify-between">
        <p className="text-[13px] font-semibold text-[#0e0f1a]">Tasks</p>
        <span className="text-[12.5px] font-semibold text-[#3f3cf0]">+ Add task</span>
      </div>
      <ul className="mt-2.5 flex flex-col gap-2">
        {tasks.map((task) => (
          <li key={task.title} className="flex items-center gap-2.5 rounded-[11px] bg-[#f6f7fb] px-3 py-2.5">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#1d2033]">{task.title}</span>
            <span className="text-[11.5px] text-[#80849a] tabular-nums">{task.time}</span>
            <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS_CHIP[task.status])}>{task.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PulseCard({ load }: { load: Load }) {
  const teams = load.state === 'ready' ? [...load.teams].filter((t) => t.members > 0).sort((a, b) => b.members - a.members).slice(0, 4) : [];
  const all = load.state === 'ready' ? load.teams : [];
  const reported = all.reduce((n, t) => n + t.reported, 0);
  const members = all.reduce((n, t) => n + t.members, 0);
  const share = members ? Math.round((100 * reported) / members) : 0;
  const leader = [...teams].sort((a, b) => b.reported / b.members - a.reported / a.members)[0];
  return (
    <div data-hero-card data-tilt="0" className={cx(CARD, 'w-full max-w-[290px] p-5 text-left')}>
      <div className="flex items-center justify-between rounded-[13px] bg-[#f6f7fb] px-3.5 py-3">
        <div>
          <p className="text-[12.5px] text-[#80849a]">Logged today</p>
          <p className="text-[22px] leading-tight font-bold tracking-[-0.02em] text-[#0e0f1a] tabular-nums">
            {load.state === 'ready' ? `${reported} / ${members}` : '—'}
          </p>
        </div>
        <span className="rounded-full bg-[#e7f5ee] px-2 py-0.5 text-[12px] font-semibold text-[#16704a] tabular-nums">{share}%</span>
      </div>
      <ul className="mt-4 flex flex-col gap-3">
        {(teams.length ? teams : [null, null, null]).map((team, i) => (
          <li key={team?.slug ?? i}>
            <div className="mb-1.5 flex items-center justify-between text-[12px]">
              <span className="truncate font-medium text-[#2b2e42]">{team ? team.name : ' '}</span>
              <span className="text-[#80849a] tabular-nums">{team ? `${team.reported}/${team.members}` : ''}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-[#eef0f7]">
              {team && (
                <div
                  data-bar
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(4, (100 * team.reported) / team.members)}%`, backgroundColor: i % 2 ? '#f76707' : INDIGO }}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center gap-2.5 rounded-[12px] border border-[#ecedf4] px-3 py-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-[#eceafe] text-[#3f3cf0]" aria-hidden="true">
          <svg viewBox="0 0 16 16" className="size-4">
            <path d="M3 13V8m5 5V4m5 9V6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </span>
        <p className="text-[12px] leading-snug text-[#4a4e63]">
          {leader && leader.reported > 0 ? `${leader.name}’s team is furthest along today.` : 'Bars fill up as people log their day.'}
        </p>
      </div>
    </div>
  );
}

function RatingCard() {
  return (
    <div data-hero-card data-tilt="3" className={cx(CARD, 'w-full max-w-[310px] p-5 text-left')}>
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-[10px] bg-[#f3f2ff] text-[#3f3cf0]" aria-hidden="true">
          <svg viewBox="0 0 16 16" className="size-[18px]">
            <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6 4.2 13.6l.7-4.3-3.1-3 4.3-.6z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
        </span>
        <div>
          <p className="text-[14.5px] font-semibold text-[#0e0f1a]">How a day is rated</p>
          <p className="text-[12.5px] text-[#80849a]">One verdict for the whole day</p>
        </div>
      </div>
      <ul className="mt-4 flex flex-col gap-1.5">
        {VERDICTS.map((v) => (
          <li key={v.key} className="flex items-center gap-2.5 rounded-[11px] bg-[#f6f7fb] px-3 py-2">
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: v.ink }} />
            <span className="flex-1 text-[13px] font-medium text-[#1d2033]">{v.label}</span>
            <span className="text-[12px] font-semibold text-[#80849a] tabular-nums">{v.points} pts</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {BROWNIES.map((b) => (
          <span key={b.key} className="rounded-full border border-[#efdcb8] bg-[#fdf6e9] px-2.5 py-0.5 text-[11.5px] font-semibold text-[#7a5312]">
            +1 {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ───────────── feature previews ───────────── */

function AddPeopleMock() {
  const people = [
    { name: 'Riya Kapoor', state: 'Logged today', tone: 'bg-[#e7f5ee] text-[#16704a]' },
    { name: 'Kabir Mehta', state: 'On leave', tone: 'bg-[#f1f2f7] text-[#5b5f73]' },
    { name: 'Ananya Rao', state: 'Logged today', tone: 'bg-[#e7f5ee] text-[#16704a]' },
    { name: 'Vikram Singh', state: 'Not yet', tone: 'bg-[#fdeaea] text-[#b0242c]' },
  ];
  return (
    <div className={cx(CARD, 'mx-auto w-full max-w-[440px] p-6')}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[16px] font-semibold text-[#0e0f1a]">Add employees</p>
          <p className="mt-0.5 text-[13px] text-[#80849a]">One name per line. They can log straight away.</p>
        </div>
        <span className="text-[18px] leading-none text-[#a3a6b8]" aria-hidden="true">
          ×
        </span>
      </div>
      <p className="mt-5 mb-1.5 text-[13px] font-medium text-[#2b2e42]">Names</p>
      <div className="flex gap-2">
        <div className="flex-1 rounded-[10px] border border-[#e1e3ee] px-3 py-2 text-[13px] leading-[1.55] text-[#2b2e42]">
          Riya Kapoor
          <br />
          Kabir Mehta
          <br />
          <span className="text-[#a3a6b8]">Ananya Rao</span>
        </div>
        <span className="self-end rounded-[10px] bg-[#3f3cf0] px-3.5 py-2 text-[13px] font-semibold whitespace-nowrap text-white">Add 3</span>
      </div>
      <p className="mt-5 text-[13px] font-medium text-[#2b2e42]">4 people on this team</p>
      <ul className="mt-2 flex flex-col">
        {people.map((p) => (
          <li key={p.name} className="flex items-center gap-3 border-b border-[#f0f1f6] py-2.5 last:border-b-0">
            <span
              className="flex size-8 items-center justify-center rounded-full text-[11.5px] font-bold text-white"
              style={{ backgroundColor: colorFor(p.name) }}
            >
              {initials(p.name)}
            </span>
            <span className="flex-1 text-[13.5px] font-medium text-[#1d2033]">{p.name}</span>
            <span className={cx('rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold', p.tone)}>{p.state}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RateMock() {
  const picked = 'over_performed';
  return (
    <div className={cx(CARD, 'mx-auto w-full max-w-[460px] p-6')}>
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-full text-[12px] font-bold text-white" style={{ backgroundColor: colorFor('Ananya Rao') }}>
          AR
        </span>
        <div className="flex-1">
          <p className="text-[15px] font-semibold text-[#0e0f1a]">Ananya Rao</p>
          <p className="text-[12.5px] text-[#80849a]">Full day, 3 tasks, 6h 10m</p>
        </div>
        <span className="rounded-full bg-[#e7f5ee] px-2.5 py-0.5 text-[11.5px] font-semibold text-[#16704a]">Reported</span>
      </div>
      <div className="mt-5 grid gap-2 sm:grid-cols-[1fr_170px]">
        <ul className="flex flex-col gap-1.5">
          {['Seat plan review', 'Biometric checks', 'Incident report'].map((t, i) => (
            <li key={t} className="flex items-center gap-2 rounded-[10px] bg-[#f6f7fb] px-3 py-2 text-[12.5px] font-medium text-[#1d2033]">
              <span className="flex-1 truncate">{t}</span>
              <span className={cx('rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold', i === 2 ? STATUS_CHIP.rework : STATUS_CHIP.done)}>
                {i === 2 ? 'Rework' : 'Done'}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-1">
          {VERDICTS.map((v) => {
            const on = v.key === picked;
            return (
              <span
                key={v.key}
                className="flex items-center gap-1.5 rounded-[7px] border px-2 py-[3px] text-[11px] font-semibold"
                style={on ? { backgroundColor: v.bg, borderColor: v.ink, color: v.ink } : { borderColor: '#ecedf4', color: '#80849a' }}
              >
                <span className="size-2 rounded-[2px]" style={{ backgroundColor: v.line }} />
                {v.label}
              </span>
            );
          })}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {BROWNIES.map((b, i) => (
          <span
            key={b.key}
            className={cx(
              'rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold',
              i === 0 ? 'border-[#efdcb8] bg-[#fdf6e9] text-[#7a5312]' : 'border-[#ecedf4] text-[#a3a6b8]',
            )}
          >
            {b.label}
          </span>
        ))}
        <span className="ml-auto text-[12px] font-semibold text-[#3f3cf0] tabular-nums">5 points</span>
      </div>
    </div>
  );
}

/* ───────────── FAQ ───────────── */

const FAQ = [
  {
    q: 'Do I need an account to log my day?',
    a: 'No. Open your team’s board from the list on this page, pick your name, and add your tasks. Your browser remembers who you are on that team.',
  },
  {
    q: 'Can I add or fix an earlier day?',
    a: 'Team boards are open for today. The super admin can open a backfill window for recent days. Your manager can change any past day for you.',
  },
  {
    q: 'Who rates my day, and how are points counted?',
    a: 'Your manager (or the super admin) gives one verdict for the whole day: Not up to the mark is 1 point, up to Extraordinary at 5. Overtime, working a holiday and saving the day each add a brownie worth 1 point.',
  },
  {
    q: 'Why does the manager page ask for the password every time?',
    a: 'Sign-ins aren’t remembered on purpose. Every time a manager or the super admin opens their page, a reload or a new tab included, they enter the password again.',
  },
  {
    q: 'Can I attach files to a task?',
    a: 'Yes, one file per task, up to 10 MB. It opens from that task on the board.',
  },
  {
    q: 'Which time zone does the board use?',
    a: 'India Standard Time. The day rolls over at midnight IST for everyone, wherever they are.',
  },
];

function FaqItem({ q, a, open, onToggle, id }: { q: string; a: string; open: boolean; onToggle: () => void; id: string }) {
  return (
    <div className="rounded-[14px] border border-[#e9eaf3] bg-white">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={id}
        className="home-focus flex w-full items-center justify-between gap-4 rounded-[14px] px-5 py-4 text-left text-[15px] font-semibold text-[#14152a]"
      >
        {q}
        <span className={cx('text-[20px] leading-none text-[#3f3cf0] transition-transform duration-300', open && 'rotate-45')} aria-hidden="true">
          +
        </span>
      </button>
      <div id={id} className={cx('grid transition-[grid-template-rows] duration-300 ease-out', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
        <div className="overflow-hidden">
          <p className="px-5 pb-5 text-[14.5px] leading-[1.6] text-[#5b5f73]">{a}</p>
        </div>
      </div>
    </div>
  );
}

/* ───────────── teams ───────────── */

function TeamCard({ team }: { team: TeamLink }) {
  const board = links.board(team.slug);
  const share = team.members ? Math.min(team.reported / team.members, 1) : 0;
  return (
    <li className={cx(CARD, 'flex flex-col p-5 transition-transform duration-200 hover:-translate-y-0.5')}>
      <div className="flex items-center gap-3">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white"
          style={{ backgroundColor: colorFor(team.slug) }}
          aria-hidden="true"
        >
          {initials(team.name)}
        </span>
        <div className="min-w-0">
          <a href={board} className="home-focus block truncate rounded-[4px] text-[16.5px] font-semibold tracking-[-0.01em] text-[#0e0f1a] hover:text-[#3f3cf0]">
            {team.name}
          </a>
          <p className="truncate text-[12.5px] text-[#80849a]">{displayLink(board)}</p>
        </div>
      </div>
      <div className="mt-5">
        <div className="mb-1.5 flex items-center justify-between text-[12.5px]">
          <span className="text-[#4a4e63]">{progressText(team)}</span>
          <span className="font-semibold text-[#14152a] tabular-nums">{Math.round(share * 100)}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[#eef0f7]">
          <div data-team-bar className="h-full rounded-full bg-[#3f3cf0]" style={{ width: `${share * 100}%` }} />
        </div>
      </div>
      <div className="mt-5 flex items-center gap-4">
        <a href={board} className={cx(BTN_PRIMARY, 'h-10 flex-1 text-[14px]')}>
          Open board
        </a>
        <a
          href={links.rating(team.slug)}
          className="home-focus rounded-[4px] text-[13.5px] font-medium text-[#5b5f73] underline decoration-[#d4d6e3] underline-offset-[5px] hover:text-[#14152a] hover:decoration-[#14152a]"
        >
          Manager sign-in
        </a>
      </div>
    </li>
  );
}

function TeamSkeleton() {
  return (
    <li className={cx(CARD, 'p-5')}>
      <div className="flex items-center gap-3">
        <div className="size-10 animate-pulse rounded-full bg-[#eef0f7]" />
        <div className="flex-1">
          <div className="h-4 w-32 animate-pulse rounded bg-[#eef0f7]" />
          <div className="mt-2 h-3 w-40 animate-pulse rounded bg-[#f3f4f9]" />
        </div>
      </div>
      <div className="mt-6 h-2 animate-pulse rounded-full bg-[#eef0f7]" />
      <div className="mt-6 h-10 animate-pulse rounded-[11px] bg-[#eef0f7]" />
    </li>
  );
}

/* ───────────── page ───────────── */

export function Home() {
  const root = useRef<HTMLDivElement>(null);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [faq, setFaq] = useState<number | null>(0);
  const t = today();

  const fetchTeams = useCallback(async () => {
    setLoad({ state: 'loading' });
    try {
      const res = await api.teams();
      setLoad({ state: 'ready', teams: res.teams });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'no_database') setLoad({ state: 'setup' });
      else setLoad({ state: 'error', message: errorText(error, 'Something went wrong.') });
    }
  }, []);

  useEffect(() => {
    document.title = `In my arc — ${APP.org} daily log`;
    void fetchTeams();
  }, [fetchTeams]);

  // One entrance: the headline settles, then the three cards rise into place.
  useLayoutEffect(() => {
    if (reducedMotion() || !root.current) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.fromTo('[data-hero-line]', { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.8, stagger: 0.1 })
        .fromTo('[data-hero-fade]', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.08 }, 0.25)
        .fromTo(
          '[data-hero-card]',
          { opacity: 0, y: 56, rotate: (_i: number, el: Element) => Number((el as HTMLElement).dataset.tilt ?? 0) },
          { opacity: 1, y: 0, rotate: 0, duration: 1, stagger: 0.12 },
          0.45,
        );
    }, root);
    return () => ctx.revert();
  }, []);

  // Bars grow once the real numbers arrive.
  useLayoutEffect(() => {
    if (load.state !== 'ready' || reducedMotion() || !root.current) return;
    const ctx = gsap.context(() => {
      gsap.from('[data-bar], [data-team-bar]', { width: 0, duration: 1.1, ease: 'power3.out', stagger: 0.06, delay: 0.5 });
    }, root);
    return () => ctx.revert();
  }, [load]);

  const teams = useMemo(() => (load.state === 'ready' ? load.teams : []), [load]);
  const reported = teams.reduce((n, x) => n + x.reported, 0);
  const members = teams.reduce((n, x) => n + x.members, 0);

  return (
    <div ref={root} className="home min-h-screen overflow-x-clip bg-[#f6f7fb] font-sans text-[#14152a]">
      {/* hero */}
      <div className="relative bg-[radial-gradient(1100px_560px_at_50%_-8%,#dfe1fc_0%,rgba(223,225,252,0.55)_42%,rgba(246,247,251,0)_75%)]">
        <header className="mx-auto flex w-full max-w-[1200px] items-center justify-between px-5 py-5 sm:px-8">
          <a href="/" className="home-focus rounded-[8px]">
            <Logo />
          </a>
          <nav className="hidden items-center gap-8 text-[14px] font-medium text-[#4a4e63] md:flex" aria-label="Sections">
            <a href="#how" className="home-focus rounded-[4px] hover:text-[#0e0f1a]">
              How it works
            </a>
            <a href="#teams" className="home-focus rounded-[4px] hover:text-[#0e0f1a]">
              Teams
            </a>
            <a href="#faq" className="home-focus rounded-[4px] hover:text-[#0e0f1a]">
              FAQ
            </a>
          </nav>
          <div className="flex items-center gap-3">
            <a href="/admin" className="home-focus hidden rounded-[4px] text-[14px] font-medium text-[#4a4e63] hover:text-[#0e0f1a] sm:block">
              Super admin
            </a>
            <a href="#teams" className={cx(BTN_PRIMARY, 'h-10 px-4 text-[14px]')}>
              Find your team
            </a>
          </div>
        </header>

        <section className="mx-auto w-full max-w-[1200px] px-5 pt-12 pb-20 text-center sm:px-8 sm:pt-16" aria-labelledby="home-title">
          <div data-hero-fade className={cx(PILL, 'mx-auto')}>
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#22c55e] opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-[#16a34a]" />
            </span>
            {load.state === 'ready' && members > 0
              ? `${reported} of ${members} people have logged today`
              : `${weekdayName(t)}, ${longDate(t).replace(/ \d{4}$/, '')}`}
          </div>
          <h1 id="home-title" className="mx-auto mt-6 max-w-[14ch] text-[clamp(42px,6.6vw,78px)] leading-[1.02] font-semibold tracking-[-0.045em] text-[#0e0f1a]">
            <span data-hero-line className="block">
              Every workday,
            </span>
            <span data-hero-line className="block">
              in one place.
            </span>
          </h1>
          <p data-hero-fade className="mx-auto mt-6 max-w-[56ch] text-[17px] leading-[1.6] text-balance text-[#5b5f73]">
            Log tasks, time and attendance in a minute. Managers rate the whole day, and everyone can see how their week is going.
          </p>
          <div data-hero-fade className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a href="#teams" className={BTN_PRIMARY}>
              Find your team
            </a>
            <a href="#how" className={BTN_SECONDARY}>
              See how it works
            </a>
          </div>

          <div className="relative mx-auto mt-16 grid max-w-[1040px] grid-cols-1 items-start justify-items-center gap-6 md:grid-cols-2 lg:grid-cols-3">
            <DayCard />
            <div className="lg:mt-12">
              <PulseCard load={load} />
            </div>
            <div className="hidden md:block">
              <RatingCard />
            </div>
          </div>
        </section>
      </div>

      {/* teams strip */}
      {teams.length > 0 && (
        <section className="mx-auto w-full max-w-[1200px] px-5 pb-6 text-center sm:px-8" aria-label="Teams using the daily log">
          <p className="text-[13px] font-medium text-[#80849a]">Teams on the daily log</p>
          <ul className="mt-4 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
            {teams.map((team) => (
              <li key={team.slug} className="flex items-center gap-2 text-[15px] font-semibold text-[#9a9db0]">
                <span className="size-2 rounded-full" style={{ backgroundColor: colorFor(team.slug) }} />
                {team.name}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* features */}
      <section className="mx-auto grid w-full max-w-[1200px] items-center gap-12 px-5 py-20 sm:px-8 lg:grid-cols-2 lg:gap-16" aria-labelledby="feature-admin">
        <div>
          <SectionPill>For the super admin</SectionPill>
          <h2 id="feature-admin" className="mt-5 max-w-[16ch] text-[clamp(30px,3.6vw,44px)] leading-[1.08] font-semibold tracking-[-0.035em] text-balance text-[#0e0f1a]">
            Bring every team on board in minutes
          </h2>
          <p className="mt-5 max-w-[48ch] text-[16px] leading-[1.6] text-[#5b5f73]">
            Create a manager, give them a link name and a password, and paste in their people. Employees don’t need accounts: their team’s board link is
            all they use.
          </p>
          <ul className="mt-7 flex flex-col gap-3.5">
            <Check>One board link per team, one rating page per manager</Check>
            <Check>Add, move or deactivate employees whenever you need to</Check>
            <Check>Every team on one board, with combined stats and reports</Check>
          </ul>
        </div>
        <AddPeopleMock />
      </section>

      <section className="mx-auto grid w-full max-w-[1200px] items-center gap-12 px-5 pb-20 sm:px-8 lg:grid-cols-2 lg:gap-16" aria-labelledby="feature-manager">
        <div className="order-2 lg:order-1">
          <RateMock />
        </div>
        <div className="order-1 lg:order-2">
          <SectionPill>For managers</SectionPill>
          <h2 id="feature-manager" className="mt-5 max-w-[16ch] text-[clamp(30px,3.6vw,44px)] leading-[1.08] font-semibold tracking-[-0.035em] text-balance text-[#0e0f1a]">
            Rate the whole day, not every task
          </h2>
          <p className="mt-5 max-w-[48ch] text-[16px] leading-[1.6] text-[#5b5f73]">
            Five clear verdicts and three brownies, given right on the day’s board. The day’s report downloads as a PDF in one click.
          </p>
          <ul className="mt-7 flex flex-col gap-3.5">
            <Check>Verdicts from Not up to the mark to Extraordinary</Check>
            <Check>Brownies for overtime, working a holiday and saving the day</Check>
            <Check>Weekly and monthly standings, by verdict or by points</Check>
          </ul>
        </div>
      </section>

      {/* how it works */}
      <section id="how" className="scroll-mt-6 border-y border-[#e9eaf3] bg-white" aria-labelledby="how-title">
        <div className="mx-auto w-full max-w-[1200px] px-5 py-20 sm:px-8">
          <div className="text-center">
            <SectionPill>How it works</SectionPill>
            <h2 id="how-title" className="mt-5 text-[clamp(30px,3.6vw,44px)] leading-[1.08] font-semibold tracking-[-0.035em] text-balance text-[#0e0f1a]">
              Three steps, every day
            </h2>
          </div>
          <ol className="mt-12 grid gap-5 md:grid-cols-3">
            {[
              { t: 'The super admin sets up teams', d: 'Each manager gets a team board link and a password. Their people are added by name.' },
              { t: 'Everyone logs their day', d: 'Open your team’s board, pick your name, mark attendance and add tasks with time and status.' },
              { t: 'Managers rate it', d: 'One verdict for the whole day, brownies where they’re earned, and a graph that shows the trend.' },
            ].map((s, i) => (
              <li key={s.t} className="rounded-[18px] border border-[#e9eaf3] bg-[#f9f9fd] p-6">
                <span className="flex size-9 items-center justify-center rounded-full bg-[#3f3cf0] text-[14px] font-bold text-white">{i + 1}</span>
                <p className="mt-5 text-[17px] font-semibold tracking-[-0.01em] text-[#0e0f1a]">{s.t}</p>
                <p className="mt-2 text-[14.5px] leading-[1.6] text-[#5b5f73]">{s.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* teams */}
      <section id="teams" className="mx-auto w-full max-w-[1200px] scroll-mt-6 px-5 py-20 sm:px-8" aria-labelledby="teams-title">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <SectionPill>Teams</SectionPill>
            <h2 id="teams-title" className="mt-5 text-[clamp(30px,3.6vw,44px)] leading-[1.08] font-semibold tracking-[-0.035em] text-balance text-[#0e0f1a]">
              Find your team
            </h2>
            <p className="mt-3 max-w-[52ch] text-[16px] leading-[1.6] text-[#5b5f73]">
              Open your team’s board to log today. Managers sign in from the same card.
            </p>
          </div>
        </div>

        {load.state === 'loading' && (
          <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading teams">
            <TeamSkeleton />
            <TeamSkeleton />
            <TeamSkeleton />
          </ul>
        )}
        {load.state === 'ready' && teams.length > 0 && (
          <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {teams.map((team) => (
              <TeamCard key={team.slug} team={team} />
            ))}
          </ul>
        )}
        {load.state === 'ready' && teams.length === 0 && (
          <div className={cx(CARD, 'mt-10 px-6 py-12 text-center')}>
            <p className="text-[18px] font-semibold text-[#0e0f1a]">No teams yet</p>
            <p className="mx-auto mt-2 max-w-[46ch] text-[15px] leading-[1.6] text-[#5b5f73]">
              The super admin creates each manager’s team and adds its people. Team links show up here as soon as they exist.
            </p>
            <a href="/admin" className={cx(BTN_PRIMARY, 'mt-6')}>
              Open super admin
            </a>
          </div>
        )}
        {load.state === 'error' && (
          <div className={cx(CARD, 'mt-10 px-6 py-12 text-center')}>
            <p className="text-[18px] font-semibold text-[#0e0f1a]">The team list didn’t load</p>
            <p className="mx-auto mt-2 max-w-[48ch] text-[15px] leading-[1.6] text-[#5b5f73]">{load.message}</p>
            <button type="button" onClick={() => void fetchTeams()} className={cx(BTN_SECONDARY, 'mt-6')}>
              Try again
            </button>
          </div>
        )}
        {load.state === 'setup' && (
          <div className="mt-10">
            <SetupNotice />
          </div>
        )}
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto w-full max-w-[860px] scroll-mt-6 px-5 pb-24 sm:px-8" aria-labelledby="faq-title">
        <div className="text-center">
          <SectionPill>Questions</SectionPill>
          <h2 id="faq-title" className="mt-5 text-[clamp(30px,3.6vw,44px)] leading-[1.08] font-semibold tracking-[-0.035em] text-balance text-[#0e0f1a]">
            Everything you need to know
          </h2>
        </div>
        <div className="mt-10 flex flex-col gap-3">
          {FAQ.map((item, i) => (
            <FaqItem key={item.q} id={`faq-${i}`} q={item.q} a={item.a} open={faq === i} onToggle={() => setFaq(faq === i ? null : i)} />
          ))}
        </div>
      </section>

      <footer className="border-t border-[#e9eaf3] bg-white">
        <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-4 px-5 py-8 text-[13.5px] text-[#80849a] sm:px-8">
          <div className="flex items-center gap-3">
            <Logo />
            <span>Internal to {APP.org}.</span>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <a href="#teams" className="home-focus rounded-[4px] hover:text-[#14152a]">
              Teams
            </a>
            <a href="/admin" className="home-focus rounded-[4px] hover:text-[#14152a]">
              Super admin
            </a>
            <span>Days follow India time (IST).</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
