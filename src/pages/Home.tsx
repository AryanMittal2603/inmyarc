import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { SetupNotice } from '../components/SetupNotice';
import { ApiError, api, errorText } from '../lib/api';
import { APP, longDate, today, weekdayName } from '../lib/config';
import { displayLink, links } from '../lib/routes';
import { HORIZON, SITE, clock, compass, horizontal, istMinutes, istMoment, sunAt, sunDay, type SunPoint } from '../lib/sun';
import type { TeamLink } from '../lib/types';

/*
 * The front door. The hero is a sun-path diagram: the sky over the team as seen from above,
 * horizon at the rim, zenith in the middle. Today's arc of the sun is drawn in gold over the
 * solstice and equinox arcs, and the gold dot is the sun right now. Below, every team with an
 * orbit that sweeps round as its people log today.
 */

const C = 300; // centre of the 600 × 600 chart
const R = 228; // the horizon

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Plan view, north up: zenith at the centre, the horizon at radius R. Below the horizon falls outside the rim. */
function project({ alt, az }: SunPoint): [number, number] {
  const r = (R * (90 - Math.max(alt, -18))) / 90;
  const a = (az * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)];
}

function pathOf(points: SunPoint[]): string {
  return points.map((p, i) => `${i ? 'L' : 'M'}${project(p).map((n) => n.toFixed(1)).join(' ')}`).join(' ');
}

/** A whole day's arc above the horizon for a fixed declination (the reference arcs). */
function arcFor(dec: number): string {
  const points: SunPoint[] = [];
  for (let h = -180; h <= 180; h += 1) {
    const p = horizontal(dec, h);
    if (p.alt >= HORIZON) points.push(p);
  }
  return pathOf(points);
}

const REFERENCE = [
  { key: 'june', label: 'Jun 21', dec: 23.44 },
  { key: 'equinox', label: 'Mar 20, Sep 23', dec: 0 },
  { key: 'december', label: 'Dec 21', dec: -23.44 },
].map((r) => {
  const noon = project(horizontal(r.dec, 0));
  return { ...r, d: arcFor(r.dec), noon };
});

function SunChart({ day, now }: { day: string; now: Date }) {
  const sun = useMemo(() => sunDay(day), [day]);
  const minutes = istMinutes(now);
  const current = sunAt(now);
  const up = current.alt >= HORIZON;

  const todayPath = useMemo(() => {
    if (sun.sunrise === null || sun.sunset === null) return '';
    const points: SunPoint[] = [];
    for (let m = sun.sunrise; m <= sun.sunset; m += 3) points.push(sunAt(istMoment(day, m)));
    points.push(sunAt(istMoment(day, sun.sunset)));
    return pathOf(points);
  }, [day, sun]);

  const hours = useMemo(() => {
    if (sun.sunrise === null || sun.sunset === null) return [];
    const list: Array<{ h: number; x: number; y: number; lx: number; ly: number }> = [];
    for (let h = Math.ceil(sun.sunrise / 60); h * 60 <= sun.sunset; h += 1) {
      const [x, y] = project(sunAt(istMoment(day, h * 60)));
      const dx = x - C;
      const dy = y - C;
      const len = Math.hypot(dx, dy) || 1;
      // Labels sit on the zenith side of the arc, clear of the reference arcs further out.
      list.push({ h, x, y, lx: x - (dx / len) * 13, ly: y - (dy / len) * 13 + 3.5 });
    }
    return list;
  }, [day, sun]);

  const [sx, sy] = project(current);
  const root = useRef<SVGSVGElement>(null);
  const marker = useRef<SVGGElement>(null);

  // The one moving moment: the frame settles, today's arc draws, and the sun travels to now.
  useLayoutEffect(() => {
    if (!root.current) return;
    const ctx = gsap.context(() => {
      const arcs = gsap.utils.toArray<SVGPathElement>('[data-draw]');
      for (const arc of arcs) {
        const length = arc.getTotalLength();
        gsap.set(arc, { strokeDasharray: `${length} ${length + 40}`, strokeDashoffset: reducedMotion() ? 0 : length + 4 });
      }
      if (reducedMotion()) return;
      const tl = gsap.timeline();
      tl.fromTo('[data-frame]', { opacity: 0 }, { opacity: 1, duration: 0.7, ease: 'power1.out' }, 0)
        .to('[data-draw="ref"]', { strokeDashoffset: 0, duration: 1, ease: 'power2.out', stagger: 0.12 }, 0.15)
        .to('[data-draw="today"]', { strokeDashoffset: 0, duration: 1.5, ease: 'power2.inOut' }, 0.45)
        .fromTo('[data-hour]', { opacity: 0 }, { opacity: 1, duration: 0.3, stagger: 0.07 }, 0.6);
      if (marker.current) {
        const start = up && sun.sunrise !== null ? sun.sunrise : minutes;
        const proxy = { m: start };
        const place = () => {
          const [x, y] = project(sunAt(istMoment(day, proxy.m)));
          marker.current?.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
        };
        place();
        tl.fromTo(marker.current, { opacity: 0 }, { opacity: 1, duration: 0.4 }, 0.6).to(
          proxy,
          { m: minutes, duration: up ? 1.7 : 0.01, ease: 'power2.inOut', onUpdate: place },
          0.65,
        );
      }
    }, root);
    return () => ctx.revert();
    // Runs once per page view; the minute-by-minute updates just move the marker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  const ticks = useMemo(() => {
    const list: Array<{ deg: number; x1: number; y1: number; x2: number; y2: number; major: boolean }> = [];
    for (let deg = 0; deg < 360; deg += 5) {
      const major = deg % 30 === 0;
      const a = (deg * Math.PI) / 180;
      const r1 = R + 3;
      const r2 = R + (major ? 13 : deg % 15 === 0 ? 9 : 6);
      list.push({ deg, major, x1: C + r1 * Math.sin(a), y1: C - r1 * Math.cos(a), x2: C + r2 * Math.sin(a), y2: C - r2 * Math.cos(a) });
    }
    return list;
  }, []);

  const label =
    sun.sunrise !== null && sun.sunset !== null
      ? `Sun path over ${SITE.name} today: it rises at ${clock(sun.sunrise)} in the ${compass(sunAt(istMoment(day, sun.sunrise)).az)}, peaks at ${Math.round(sun.peak)}° at ${clock(sun.noon)} and sets at ${clock(sun.sunset)}. It is now ${Math.abs(Math.round(current.alt))}° ${up ? 'above' : 'below'} the horizon.`
      : `Sun path over ${SITE.name} today.`;

  return (
    <svg ref={root} viewBox="0 0 600 600" className="h-auto w-full overflow-visible" role="img" aria-label={label}>
      <defs>
        <radialGradient id="sun-glow">
          <stop offset="0" stopColor="#f3c46b" stopOpacity="0.55" />
          <stop offset="0.45" stopColor="#f3c46b" stopOpacity="0.16" />
          <stop offset="1" stopColor="#f3c46b" stopOpacity="0" />
        </radialGradient>
      </defs>

      <g data-frame>
        <circle cx={C} cy={C} r={R} fill="#0e1842" stroke="rgba(190,205,255,0.42)" strokeWidth="1" />
        {[60, 30].map((alt) => {
          const r = (R * (90 - alt)) / 90;
          const lx = C + r * Math.SQRT1_2 + 5;
          const ly = C - r * Math.SQRT1_2 - 5;
          return (
            <g key={alt}>
              <circle cx={C} cy={C} r={r} fill="none" stroke="rgba(190,205,255,0.16)" strokeDasharray="2 5" />
              <text x={lx} y={ly} className="fill-[#6d7aa3] text-[10px]">
                {alt}°
              </text>
            </g>
          );
        })}
        <line x1={C} y1={C - R} x2={C} y2={C + R} stroke="rgba(190,205,255,0.1)" />
        <line x1={C - R} y1={C} x2={C + R} y2={C} stroke="rgba(190,205,255,0.1)" />
        <path d={`M${C - 5} ${C}h10M${C} ${C - 5}v10`} stroke="rgba(190,205,255,0.5)" />
        {ticks.map((t) => (
          <line key={t.deg} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={t.major ? 'rgba(190,205,255,0.6)' : 'rgba(190,205,255,0.28)'} />
        ))}
        {[
          { t: 'N', deg: 0 },
          { t: 'E', deg: 90 },
          { t: 'S', deg: 180 },
          { t: 'W', deg: 270 },
        ].map(({ t, deg }) => {
          const a = (deg * Math.PI) / 180;
          return (
            <text
              key={t}
              x={C + (R + 30) * Math.sin(a)}
              y={C - (R + 30) * Math.cos(a) + 5}
              textAnchor="middle"
              className="fill-[#dfe5f7] text-[15px] font-[600]"
            >
              {t}
            </text>
          );
        })}
        {[30, 60, 120, 150, 210, 240, 300, 330].map((deg) => {
          const a = (deg * Math.PI) / 180;
          return (
            <text key={deg} x={C + (R + 28) * Math.sin(a)} y={C - (R + 28) * Math.cos(a) + 4} textAnchor="middle" className="tnum fill-[#6d7aa3] text-[10px]">
              {deg}
            </text>
          );
        })}
      </g>

      {REFERENCE.map((r) => (
        <g key={r.key}>
          <path data-draw="ref" d={r.d} fill="none" stroke="rgba(190,205,255,0.34)" strokeWidth="1" />
          <text data-frame x={r.noon[0] + 7} y={r.noon[1] + (r.key === 'june' ? -8 : 14)} className="fill-[#7f8bb3] text-[10px]">
            {r.label}
          </text>
        </g>
      ))}

      {todayPath && <path data-draw="today" d={todayPath} fill="none" stroke="#f3c46b" strokeWidth="2.25" strokeLinecap="round" />}
      {hours.map((h) => (
        <g key={h.h} data-hour>
          <circle cx={h.x} cy={h.y} r="2.4" fill="#f3c46b" />
          {h.h % 2 === 0 && (
            <text x={h.lx} y={h.ly} textAnchor="middle" className="tnum fill-[#c9b48a] text-[10px]">
              {String(h.h).padStart(2, '0')}
            </text>
          )}
        </g>
      ))}

      <g ref={marker} transform={`translate(${sx.toFixed(1)} ${sy.toFixed(1)})`}>
        {up ? (
          <>
            <circle r="30" fill="url(#sun-glow)" />
            <circle r="11" fill="none" stroke="#f3c46b" strokeOpacity="0.55" />
            <circle r="6.5" fill="#f6d48a" />
          </>
        ) : (
          <circle r="6" fill="#0a1130" stroke="#f3c46b" strokeWidth="1.5" strokeDasharray="2 2" />
        )}
      </g>
    </svg>
  );
}

function Readout({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-[#8f9bc2]">{label}</dt>
      <dd className="tnum mt-1 text-[26px] leading-none font-[560] tracking-[-0.01em] text-[#eef1fb]">{value}</dd>
      {note && <dd className="mt-1.5 text-[12.5px] leading-snug text-[#8f9bc2]">{note}</dd>}
    </div>
  );
}

type Load = { state: 'loading' } | { state: 'ready'; teams: TeamLink[] } | { state: 'setup' } | { state: 'error'; message: string };

function progressText(team: TeamLink): string {
  if (team.members === 0) return 'No one on this team yet';
  if (team.reported === 0) return 'No one has logged yet today';
  if (team.reported >= team.members) return 'Everyone has logged today';
  return `${team.reported} of ${team.members} logged today`;
}

const ORBIT = { r: 15, stroke: 2.5 };
const ORBIT_LENGTH = 2 * Math.PI * ORBIT.r;

/** The team's orbit: the gold arc sweeps round as its people log today. */
function Orbit({ team }: { team: TeamLink }) {
  const share = team.members ? Math.min(team.reported / team.members, 1) : 0;
  const angle = share * 2 * Math.PI;
  const px = 20 + ORBIT.r * Math.sin(angle);
  const py = 20 - ORBIT.r * Math.cos(angle);
  return (
    <svg viewBox="0 0 40 40" className="size-10 shrink-0" aria-hidden="true">
      <circle cx="20" cy="20" r={ORBIT.r} fill="none" stroke="rgba(190,205,255,0.2)" strokeWidth={ORBIT.stroke} />
      <circle cx="20" cy="20" r="2" fill="rgba(190,205,255,0.45)" />
      {share > 0 && (
        <circle
          data-orbit
          data-share={share}
          cx="20"
          cy="20"
          r={ORBIT.r}
          fill="none"
          stroke="#f3c46b"
          strokeWidth={ORBIT.stroke}
          strokeLinecap="round"
          strokeDasharray={ORBIT_LENGTH}
          strokeDashoffset={ORBIT_LENGTH * (1 - share)}
          transform="rotate(-90 20 20)"
        />
      )}
      <circle data-planet cx={px} cy={py} r="3.6" fill={share > 0 ? '#f6d48a' : 'rgba(190,205,255,0.55)'} />
    </svg>
  );
}

function TeamRow({ team }: { team: TeamLink }) {
  const board = links.board(team.slug);
  return (
    <li className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-x-5 gap-y-4 border-t border-[rgba(190,205,255,0.14)] px-1 py-6 transition-colors duration-200 hover:bg-white/[0.025] sm:px-4 md:grid-cols-[2.5rem_minmax(0,1fr)_14rem_auto]">
      <Orbit team={team} />
      <div className="min-w-0">
        <a href={board} className="home-focus block truncate rounded-[4px] text-[23px] leading-[1.15] font-[600] tracking-[-0.015em] text-[#eef1fb]">
          {team.name}
        </a>
        <p className="mt-1 truncate text-[13px] text-[#8f9bc2]">{displayLink(board)}</p>
      </div>
      <p className="tnum col-start-2 text-[14px] text-[#b9c3e3] md:col-start-auto">{progressText(team)}</p>
      <div className="col-span-2 flex flex-wrap items-center gap-x-5 gap-y-2 md:col-span-1">
        <a
          href={board}
          className="home-focus inline-flex h-10 items-center justify-center rounded-full bg-[#eef1fb] px-5 text-[14px] font-[600] text-[#0a1130] transition-colors duration-150 hover:bg-white max-md:flex-1"
        >
          Open board
        </a>
        <a
          href={links.rating(team.slug)}
          className="home-focus rounded-[4px] text-[14px] text-[#9aa6cc] underline decoration-[rgba(190,205,255,0.3)] underline-offset-[5px] transition-colors duration-150 hover:text-[#eef1fb] hover:decoration-[#eef1fb]"
        >
          Manager sign-in
        </a>
      </div>
    </li>
  );
}

function RowSkeleton() {
  return (
    <li className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-5 border-t border-[rgba(190,205,255,0.14)] px-1 py-6 sm:px-4 md:grid-cols-[2.5rem_minmax(0,1fr)_14rem_auto]">
      <div className="size-10 animate-pulse rounded-full bg-white/[0.06]" />
      <div>
        <div className="h-5 w-44 animate-pulse rounded-[4px] bg-white/[0.08]" />
        <div className="mt-2.5 h-3 w-32 animate-pulse rounded-[4px] bg-white/[0.05]" />
      </div>
      <div className="hidden h-4 w-36 animate-pulse rounded-[4px] bg-white/[0.05] md:block" />
      <div className="hidden h-10 w-32 animate-pulse rounded-full bg-white/[0.08] md:block" />
    </li>
  );
}

export function Home() {
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const mountedAt = useRef(performance.now());
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [now, setNow] = useState(() => new Date());
  const day = today();
  const sun = useMemo(() => sunDay(day), [day]);
  const current = sunAt(now);
  const up = current.alt >= HORIZON;

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
    document.title = `In my arc — ${APP.org}`;
    void fetchTeams();
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, [fetchTeams]);

  useLayoutEffect(() => {
    if (reducedMotion() || !root.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo('[data-title]', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', delay: 0.15 });
      gsap.fromTo('[data-settle]', { opacity: 0 }, { opacity: 1, duration: 0.7, ease: 'power1.out', stagger: 0.09, delay: 0.45 });
    }, root);
    return () => ctx.revert();
  }, []);

  // Each orbit sweeps to today's share once the list arrives (after the sky, on a fresh load).
  useLayoutEffect(() => {
    if (load.state !== 'ready' || !list.current) return;
    const ctx = gsap.context(() => {
      if (reducedMotion()) return;
      const wait = Math.max(0, 1.2 - (performance.now() - mountedAt.current) / 1000);
      gsap.fromTo(list.current, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'power1.out', delay: Math.max(0, wait - 0.4) });
      for (const [i, orbit] of gsap.utils.toArray<SVGCircleElement>('[data-orbit]').entries()) {
        gsap.fromTo(
          orbit,
          { strokeDashoffset: ORBIT_LENGTH },
          { strokeDashoffset: ORBIT_LENGTH * (1 - Number(orbit.dataset.share ?? 0)), duration: 1.2, ease: 'power3.out', delay: wait + i * 0.08 },
        );
      }
    }, list);
    return () => ctx.revert();
  }, [load]);

  const teams = load.state === 'ready' ? load.teams : [];
  const dayLength = sun.sunrise !== null && sun.sunset !== null ? sun.sunset - sun.sunrise : null;

  return (
    <div ref={root} className="home min-h-screen bg-[#0a1130] text-[#eef1fb]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1160px] flex-col px-5 sm:px-8">
        <header className="flex items-center justify-between py-6">
          <span className="text-[15px] font-[620] tracking-[0.01em]">{APP.org}</span>
          <a
            href="/admin"
            className="home-focus rounded-[4px] text-[14px] text-[#9aa6cc] underline decoration-transparent underline-offset-[5px] transition-colors duration-150 hover:text-[#eef1fb] hover:decoration-[rgba(190,205,255,0.4)]"
          >
            Super admin
          </a>
        </header>

        <section className="grid items-center gap-x-14 gap-y-8 pt-4 pb-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:pt-10" aria-labelledby="home-title">
          <div className="order-2 lg:order-1">
            <h1
              id="home-title"
              data-title
              className="text-[clamp(52px,8.4vw,104px)] leading-[0.92] font-[640] tracking-[-0.035em] [font-stretch:125%]"
            >
              In my arc
            </h1>
            <p data-settle className="mt-7 text-[19px] font-[560] tracking-[-0.005em]">
              {weekdayName(day)}, {longDate(day).replace(/ \d{4}$/, '')}
            </p>
            <p data-settle className="mt-2 max-w-[44ch] text-[16px] leading-[1.55] text-balance text-[#b9c3e3]">
              Find your team, then log today’s work on its board.
            </p>
            <dl data-settle className="mt-9 grid max-w-[440px] grid-cols-2 gap-x-10 gap-y-6 border-t border-[rgba(190,205,255,0.16)] pt-6">
              <Readout label="Sunrise" value={sun.sunrise !== null ? clock(sun.sunrise) : '—'} />
              <Readout label="Solar noon" value={clock(sun.noon)} note={`${Math.round(sun.peak)}° high`} />
              <Readout label="Sunset" value={sun.sunset !== null ? clock(sun.sunset) : '—'} note={dayLength !== null ? `${Math.floor(dayLength / 60)} h ${Math.round(dayLength % 60)} m of daylight` : undefined} />
              <Readout
                label="Sun now"
                value={`${Math.round(current.alt)}°`}
                note={up ? `up in the ${compass(current.az)}` : 'below the horizon'}
              />
            </dl>
          </div>
          <figure className="order-1 mx-auto w-full max-w-[560px] lg:order-2">
            <SunChart day={day} now={now} />
            <figcaption data-settle className="mx-auto mt-3 max-w-[46ch] text-center text-[12.5px] leading-[1.5] text-[#7f8bb3]">
              The sun’s path over {SITE.name} today in gold, with the solstices and equinoxes for comparison. The glowing dot is the sun right now.
            </figcaption>
          </figure>
        </section>

        <section className="mt-12 mb-12" aria-labelledby="teams-title">
          <div data-settle className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1 sm:px-4">
            <h2 id="teams-title" className="text-[21px] font-[620] tracking-[-0.01em]">
              Teams
            </h2>
            {load.state === 'ready' && teams.length > 0 && (
              <p className="tnum text-[13px] text-[#8f9bc2]">
                {teams.reduce((n, t) => n + t.reported, 0)} of {teams.reduce((n, t) => n + t.members, 0)} people have logged today
              </p>
            )}
          </div>

          {load.state === 'loading' && (
            <ul className="border-b border-[rgba(190,205,255,0.14)]" aria-label="Loading teams">
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
            </ul>
          )}

          {load.state === 'ready' && teams.length > 0 && (
            <ul ref={list} className="border-b border-[rgba(190,205,255,0.14)]">
              {teams.map((team) => (
                <TeamRow key={team.slug} team={team} />
              ))}
            </ul>
          )}

          {load.state === 'ready' && teams.length === 0 && (
            <div className="border-y border-[rgba(190,205,255,0.14)] px-1 py-10 text-center sm:px-4">
              <p className="text-[18px] font-[600]">No teams yet</p>
              <p className="mx-auto mt-2 max-w-[46ch] text-[15px] leading-[1.55] text-[#b9c3e3]">
                The super admin creates each manager’s team and adds its people. Team links show up here as soon as they exist.
              </p>
              <a
                href="/admin"
                className="home-focus mt-6 inline-flex h-10 items-center rounded-full bg-[#eef1fb] px-5 text-[14px] font-[600] text-[#0a1130] transition-colors duration-150 hover:bg-white"
              >
                Open super admin
              </a>
            </div>
          )}

          {load.state === 'error' && (
            <div className="border-y border-[rgba(190,205,255,0.14)] px-1 py-10 text-center sm:px-4">
              <p className="text-[18px] font-[600]">The team list didn’t load</p>
              <p className="mx-auto mt-2 max-w-[48ch] text-[15px] leading-[1.55] text-[#b9c3e3]">{load.message}</p>
              <button
                type="button"
                onClick={() => void fetchTeams()}
                className="home-focus mt-6 inline-flex h-10 items-center rounded-full border border-[rgba(190,205,255,0.4)] px-5 text-[14px] font-[600] text-[#eef1fb] transition-colors duration-150 hover:border-[#eef1fb]"
              >
                Try again
              </button>
            </div>
          )}

          {load.state === 'setup' && (
            <div className="font-sans text-ink">
              <SetupNotice />
            </div>
          )}
        </section>

        <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-[rgba(190,205,255,0.14)] py-6 text-[13px] text-[#8f9bc2]">
          <p>Internal to {APP.org}.</p>
          <p className="tnum">
            Sky for {SITE.name}, {SITE.lat}° N {SITE.lon}° E. India time, now {clock(istMinutes(now))}.
          </p>
        </footer>
      </div>
    </div>
  );
}
