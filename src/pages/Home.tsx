import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { SetupNotice } from '../components/SetupNotice';
import { cx } from '../components/ui';
import { ApiError, api, errorText } from '../lib/api';
import { APP, VERDICTS, longDate, timeOf, today, weekdayName } from '../lib/config';
import { displayLink, links } from '../lib/routes';
import type { Category, TeamLink } from '../lib/types';

/*
 * The front door: five arcs, one per verdict (best on the outside), drawn once on load,
 * then every team with how many of its people have logged today.
 */

const ARC_COLOR: Record<Category, string> = {
  extraordinary: '#a8336f',
  over_performed: '#2b5fa8',
  upto_mark: '#2a7f4f',
  can_be_better: '#bf8a12',
  not_upto_mark: '#b9443a',
};

const VIEW = { width: 640, height: 330, cx: 320, cy: 322, stroke: 11 };
const RADII = [300, 277, 254, 231, 208];
const GAUGE = { r: 17, stroke: 5 };
const GAUGE_LENGTH = Math.PI * GAUGE.r;

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function semicircle(cx: number, cy: number, r: number): string {
  return `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
}

type Load = { state: 'loading' } | { state: 'ready'; teams: TeamLink[] } | { state: 'setup' } | { state: 'error'; message: string };

function progressText(team: TeamLink): string {
  if (team.members === 0) return 'No one on this team yet';
  if (team.reported === 0) return 'No one has logged yet today';
  if (team.reported >= team.members) return 'Everyone has logged today';
  return `${team.reported} of ${team.members} logged today`;
}

function Gauge({ team }: { team: TeamLink }) {
  const share = team.members ? Math.min(team.reported / team.members, 1) : 0;
  const path = semicircle(22, 22, GAUGE.r);
  return (
    <svg viewBox="0 0 44 25" className="h-[25px] w-[44px] shrink-0" aria-hidden="true">
      <path d={path} fill="none" stroke="#e2e2dd" strokeWidth={GAUGE.stroke} strokeLinecap="round" />
      {share > 0 && (
        <path
          data-gauge
          data-share={share}
          d={path}
          fill="none"
          stroke="#16704a"
          strokeWidth={GAUGE.stroke}
          strokeLinecap="round"
          strokeDasharray={GAUGE_LENGTH}
          strokeDashoffset={GAUGE_LENGTH * (1 - share)}
        />
      )}
    </svg>
  );
}

function TeamRow({ team }: { team: TeamLink }) {
  const board = links.board(team.slug);
  return (
    <li className="group/team relative grid grid-cols-1 gap-x-8 gap-y-4 border-t border-[#e2e2dd] px-1 py-6 transition-colors duration-200 hover:bg-white/70 sm:px-4 md:grid-cols-[minmax(0,1fr)_15rem_auto] md:items-center">
      <div className="min-w-0">
        <a
          href={board}
          className="home-focus block truncate rounded-[6px] text-[26px] leading-[1.15] font-[620] tracking-[-0.025em] text-ink [font-variation-settings:'opsz'_30]"
        >
          {team.name}
        </a>
        <p className="mt-1 truncate text-[13px] text-ink-3">{displayLink(board)}</p>
      </div>
      <div className="flex items-center gap-3">
        <Gauge team={team} />
        <p className="tnum text-[14px] leading-snug text-ink-2">{progressText(team)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <a
          href={board}
          className="home-focus inline-flex h-10 items-center justify-center rounded-full bg-ink px-5 text-[14px] font-[560] text-white transition-colors duration-150 hover:bg-[#2c2c31] max-md:flex-1"
        >
          Open board
        </a>
        <a
          href={links.rating(team.slug)}
          className="home-focus rounded-[4px] text-[14px] text-ink-3 underline decoration-[#c9c9c3] underline-offset-[5px] transition-colors duration-150 hover:text-ink hover:decoration-ink"
        >
          Manager sign-in
        </a>
      </div>
    </li>
  );
}

function RowSkeleton() {
  return (
    <li className="grid grid-cols-1 gap-4 border-t border-[#e2e2dd] px-1 py-6 sm:px-4 md:grid-cols-[minmax(0,1fr)_15rem_auto] md:items-center">
      <div>
        <div className="h-6 w-48 animate-pulse rounded-[6px] bg-[#ebebe7]" />
        <div className="mt-2.5 h-3 w-36 animate-pulse rounded-[4px] bg-[#efefeb]" />
      </div>
      <div className="h-4 w-44 animate-pulse rounded-[4px] bg-[#efefeb]" />
      <div className="h-10 w-32 animate-pulse rounded-full bg-[#ebebe7]" />
    </li>
  );
}

export function Home() {
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const mountedAt = useRef(performance.now());
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [focus, setFocus] = useState<Category | null>(null);
  const [now, setNow] = useState(() => new Date().toISOString());
  const [day, setDay] = useState(today);

  const fetchTeams = useCallback(async () => {
    setLoad({ state: 'loading' });
    try {
      const res = await api.teams();
      setLoad({ state: 'ready', teams: res.teams });
      setDay(res.today);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'no_database') setLoad({ state: 'setup' });
      else setLoad({ state: 'error', message: errorText(error, 'Something went wrong.') });
    }
  }, []);

  useEffect(() => {
    document.title = `In my arc — ${APP.org}`;
    void fetchTeams();
    const timer = window.setInterval(() => setNow(new Date().toISOString()), 30_000);
    return () => window.clearInterval(timer);
  }, [fetchTeams]);

  // The one orchestrated moment: arcs draw outside-in, then the name and date settle.
  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const arcs = gsap.utils.toArray<SVGPathElement>('[data-arc]');
      for (const arc of arcs) {
        // The gap is longer than the arc and the start sits inside it, so no round-cap dots show before drawing.
        const length = arc.getTotalLength();
        gsap.set(arc, { strokeDasharray: `${length} ${length + 40}`, strokeDashoffset: reducedMotion() ? 0 : length + VIEW.stroke });
      }
      if (reducedMotion()) return;
      gsap
        .timeline()
        .to(arcs, { strokeDashoffset: 0, duration: 1.25, ease: 'power2.inOut', stagger: 0.09 })
        .fromTo('[data-title]', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out' }, 0.35)
        .fromTo('[data-settle]', { opacity: 0 }, { opacity: 1, duration: 0.6, ease: 'power1.out', stagger: 0.08 }, 0.7);
    }, root);
    return () => ctx.revert();
  }, []);

  // Each team's gauge fills to today's share once the list arrives (after the arcs, on a fresh load).
  useLayoutEffect(() => {
    if (load.state !== 'ready' || !list.current) return;
    const ctx = gsap.context(() => {
      const gauges = gsap.utils.toArray<SVGPathElement>('[data-gauge]');
      if (reducedMotion() || gauges.length === 0) return;
      const wait = Math.max(0, 1.05 - (performance.now() - mountedAt.current) / 1000);
      gsap.fromTo(
        gauges,
        { strokeDashoffset: GAUGE_LENGTH },
        {
          strokeDashoffset: (_i: number, el: Element) => GAUGE_LENGTH * (1 - Number((el as SVGPathElement).dataset.share ?? 0)),
          duration: 1.1,
          ease: 'power3.out',
          stagger: 0.09,
          delay: wait,
        },
      );
      gsap.fromTo(list.current, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'power1.out', delay: Math.max(0, wait - 0.3) });
    }, list);
    return () => ctx.revert();
  }, [load]);

  const teams = load.state === 'ready' ? load.teams : [];

  return (
    <div ref={root} className="home min-h-screen bg-paper text-ink">
      <div className="mx-auto flex min-h-screen w-full max-w-[960px] flex-col px-5 sm:px-8">
        <header className="flex items-center justify-between py-6">
          <span className="text-[15px] font-[640] tracking-[-0.01em] text-ink">{APP.org}</span>
          <a
            href="/admin"
            className="home-focus rounded-[4px] text-[14px] text-ink-3 underline decoration-transparent underline-offset-[5px] transition-colors duration-150 hover:text-ink hover:decoration-[#c9c9c3]"
          >
            Super admin
          </a>
        </header>

        <section className="flex flex-col items-center pt-6 text-center sm:pt-10" aria-labelledby="home-title">
          <figure className="@container relative mx-auto w-full max-w-[640px]" style={{ aspectRatio: `${VIEW.width} / ${VIEW.height}` }}>
            <svg
              viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
              className="absolute inset-0 h-full w-full overflow-visible"
              role="img"
              aria-label="Five arcs, one for each way a day can be rated"
            >
              {VERDICTS.map((v, i) => (
                <path
                  key={v.key}
                  data-arc
                  d={semicircle(VIEW.cx, VIEW.cy, RADII[i])}
                  fill="none"
                  stroke={ARC_COLOR[v.key]}
                  strokeWidth={VIEW.stroke}
                  strokeLinecap="round"
                  className="transition-opacity duration-300"
                  style={{ opacity: focus && focus !== v.key ? 0.14 : 1 }}
                />
              ))}
            </svg>
            <h1
              id="home-title"
              data-title
              className="absolute inset-x-0 bottom-[0.5%] text-[11.6cqw] leading-[0.9] font-[700] tracking-[-0.035em] text-ink [font-variation-settings:'opsz'_96]"
            >
              In my arc
            </h1>
          </figure>

          <p data-settle className="mt-8 text-[18px] font-[560] tracking-[-0.01em] text-ink">
            {weekdayName(day)}, {longDate(day).replace(/ \d{4}$/, '')}
          </p>
          <p data-settle className="mt-2 max-w-[44ch] text-[16px] leading-[1.5] text-balance text-ink-2">
            Find your team, then log today’s work on its board.
          </p>

          <ul data-settle className="mt-7 flex max-w-[640px] flex-wrap justify-center gap-x-5 gap-y-2" aria-label="How a day is rated, best first">
            {VERDICTS.map((v) => (
              <li
                key={v.key}
                onMouseEnter={() => setFocus(v.key)}
                onMouseLeave={() => setFocus(null)}
                className={cx(
                  'flex cursor-default items-center gap-2 text-[13px] transition-colors duration-200',
                  focus && focus !== v.key ? 'text-ink-4' : 'text-ink-3',
                )}
              >
                <span className="size-2.5 rounded-full" style={{ backgroundColor: ARC_COLOR[v.key] }} aria-hidden="true" />
                {v.label}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-16 mb-12 sm:mt-20" aria-labelledby="teams-title">
          <div data-settle className="mb-4 flex items-baseline justify-between gap-4 px-1 sm:px-4">
            <h2 id="teams-title" className="text-[21px] font-[650] tracking-[-0.02em] text-ink">
              Teams
            </h2>
            {load.state === 'ready' && teams.length > 0 && (
              <p className="tnum text-[13px] text-ink-3">
                {teams.reduce((n, t) => n + t.reported, 0)} of {teams.reduce((n, t) => n + t.members, 0)} people have logged today
              </p>
            )}
          </div>

          {load.state === 'loading' && (
            <ul className="border-b border-[#e2e2dd]" aria-label="Loading teams">
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
            </ul>
          )}

          {load.state === 'ready' && teams.length > 0 && (
            <ul ref={list} className="border-b border-[#e2e2dd]">
              {teams.map((team) => (
                <TeamRow key={team.slug} team={team} />
              ))}
            </ul>
          )}

          {load.state === 'ready' && teams.length === 0 && (
            <div className="border-y border-[#e2e2dd] px-1 py-10 text-center sm:px-4">
              <p className="text-[18px] font-[600] tracking-[-0.01em] text-ink">No teams yet</p>
              <p className="mx-auto mt-2 max-w-[44ch] text-[15px] leading-[1.55] text-ink-2">
                The super admin creates each manager’s team and adds its people. Team links show up here as soon as they exist.
              </p>
              <a
                href="/admin"
                className="home-focus mt-6 inline-flex h-10 items-center rounded-full bg-ink px-5 text-[14px] font-[560] text-white transition-colors duration-150 hover:bg-[#2c2c31]"
              >
                Open super admin
              </a>
            </div>
          )}

          {load.state === 'error' && (
            <div className="border-y border-[#e2e2dd] px-1 py-10 text-center sm:px-4">
              <p className="text-[18px] font-[600] tracking-[-0.01em] text-ink">The team list didn’t load</p>
              <p className="mx-auto mt-2 max-w-[48ch] text-[15px] leading-[1.55] text-ink-2">{load.message}</p>
              <button
                type="button"
                onClick={() => void fetchTeams()}
                className="home-focus mt-6 inline-flex h-10 items-center rounded-full border border-[#cfcfc9] bg-white px-5 text-[14px] font-[560] text-ink transition-colors duration-150 hover:border-ink"
              >
                Try again
              </button>
            </div>
          )}

          {load.state === 'setup' && (
            <div className="font-sans">
              <SetupNotice />
            </div>
          )}
        </section>

        <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-[#e2e2dd] py-6 text-[13px] text-ink-3">
          <p>Internal to {APP.org}.</p>
          <p className="tnum">Days follow India time. It’s {timeOf(now)} now.</p>
        </footer>
      </div>
    </div>
  );
}
