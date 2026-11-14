import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import gsap from 'gsap';
import { CookieIcon } from '../components/icons';
import { SetupNotice } from '../components/SetupNotice';
import { cx } from '../components/ui';
import { ApiError, api, errorText } from '../lib/api';
import { APP, BROWNIES, VERDICTS, longDate, today, weekdayName } from '../lib/config';
import { links } from '../lib/routes';
import type { TeamLink } from '../lib/types';

/*
 * The front door. It asks the question the log answers, lists every team's board, and shows
 * the product itself (real screenshots of a sample team) rather than describing it.
 * Palette and type are the product's own: paper, ink, and the verdict colours.
 */

// Content never waits on an animation: no entrance with reduced motion or in a background tab.
const skipMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.visibilityState !== 'visible';

type Load = { state: 'loading' } | { state: 'ready'; teams: TeamLink[] } | { state: 'setup' } | { state: 'error'; message: string };

const WRAP = 'mx-auto w-full max-w-[1240px] px-5 sm:px-8';
const H2 = 'font-display text-[clamp(34px,4.6vw,58px)] leading-[1.02] font-semibold tracking-[-0.035em] text-balance text-ink';
const LINK = 'focus-ring rounded-sm underline decoration-line-strong underline-offset-[5px] transition-colors hover:decoration-ink';

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
      <path d="M9 21.5 14 16l3.5 3.5L23 12" fill="none" stroke="#f6f6f4" strokeWidth="2.4" strokeLinecap="square" />
    </svg>
  );
}

/* ───────────── the team index (the page's call to action) ───────────── */

function TeamRow({ team }: { team: TeamLink }) {
  const share = team.members ? Math.min(team.reported / team.members, 1) : 0;
  return (
    <li data-row className="group relative flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line px-5 py-4 transition-colors last:border-b-0 hover:bg-[#fbfbfa] sm:flex-nowrap">
      <div className="min-w-0 basis-full sm:flex-1">
        <a
          href={links.board(team.slug)}
          className="focus-ring block truncate rounded-sm font-display text-[22px] leading-tight font-semibold tracking-[-0.02em] text-ink after:absolute after:inset-0 after:content-['']"
        >
          {team.name}
        </a>
        <div className="mt-1.5 flex items-center gap-3">
          <span className="h-[3px] w-14 shrink-0 overflow-hidden rounded-full bg-mute-bg" aria-hidden="true">
            <span data-meter className="block h-full rounded-full bg-ink" style={{ width: `${share * 100}%` }} />
          </span>
          <span className="truncate text-[13.5px] text-ink-3">{progressText(team)}</span>
        </div>
      </div>
      <div className="flex items-center gap-5">
        <span
          aria-hidden="true"
          className="inline-flex h-9 items-center rounded-md border border-line-strong bg-surface px-3.5 text-[14px] font-medium text-ink transition-colors group-hover:border-ink group-hover:bg-ink group-hover:text-paper"
        >
          Open board
        </span>
        <a href={links.rating(team.slug)} className={cx(LINK, 'relative z-10 text-[13.5px] whitespace-nowrap text-ink-2')}>
          Manager sign-in
        </a>
      </div>
    </li>
  );
}

function TeamIndex({ load, onRetry }: { load: Load; onRetry: () => void }) {
  const teams = load.state === 'ready' ? load.teams : [];
  const reported = teams.reduce((n, t) => n + t.reported, 0);
  const members = teams.reduce((n, t) => n + t.members, 0);

  let body: ReactNode;
  if (load.state === 'loading') {
    body = (
      <ul aria-label="Loading teams">
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex items-center gap-6 border-b border-line px-5 py-5 last:border-b-0">
            <div className="flex-1">
              <div className="h-5 w-40 animate-pulse rounded-sm bg-mute-bg" />
              <div className="mt-2.5 h-3 w-48 animate-pulse rounded-sm bg-mute-bg" />
            </div>
            <div className="h-9 w-28 animate-pulse rounded-md bg-mute-bg" />
          </li>
        ))}
      </ul>
    );
  } else if (load.state === 'ready' && teams.length > 0) {
    body = (
      <ul>
        {teams.map((team) => (
          <TeamRow key={team.slug} team={team} />
        ))}
      </ul>
    );
  } else if (load.state === 'ready') {
    body = (
      <div className="px-5 py-8">
        <p className="text-[17px] font-semibold text-ink">No teams yet</p>
        <p className="mt-1.5 max-w-[46ch] text-[15px] leading-[1.6] text-ink-2">
          The super admin creates each manager’s team and adds its people. Team links appear here as soon as they exist.
        </p>
        <a href="/admin" className="focus-ring mt-5 inline-flex h-10 items-center rounded-md bg-ink px-4 text-[14px] font-medium text-paper hover:bg-black">
          Open super admin
        </a>
      </div>
    );
  } else if (load.state === 'error') {
    body = (
      <div className="px-5 py-8">
        <p className="text-[17px] font-semibold text-ink">The team list didn’t load</p>
        <p className="mt-1.5 max-w-[48ch] text-[15px] leading-[1.6] text-ink-2">{load.message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="focus-ring mt-5 inline-flex h-10 items-center rounded-md border border-line-strong bg-surface px-4 text-[14px] font-medium text-ink hover:border-ink"
        >
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
    <section id="teams" data-hero-fade aria-labelledby="teams-title" className="scroll-mt-6 overflow-hidden rounded-md border border-line bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line bg-[#fbfbfa] px-5 py-3">
        <h2 id="teams-title" className="text-[14.5px] font-semibold text-ink">
          Teams
        </h2>
        {load.state === 'ready' && members > 0 && (
          <p className="text-[13.5px] text-ink-3 tabular-nums">
            {reported} of {members} people have logged today
          </p>
        )}
      </div>
      {body}
    </section>
  );
}

/* ───────────── product shots ───────────── */

function Shot({
  base,
  widths,
  height,
  alt,
  caption,
  fade,
  mobile,
  wide,
  className,
}: {
  base: string;
  widths: [number, number];
  height: number;
  alt: string;
  caption: ReactNode;
  fade?: boolean;
  /** How wide the picture is on phones, as a share of the screen: wide shots are cropped to their left part. */
  mobile: 1.7 | 2.5;
  /** Spans the full page width on large screens. */
  wide?: boolean;
  className?: string;
}) {
  const [small, large] = widths;
  return (
    <figure className={className}>
      <div
        className={cx(
          'overflow-hidden rounded-lg border border-line bg-paper',
          fade && '[mask-image:linear-gradient(to_bottom,#000_62%,transparent_98%)]',
          !fade && 'shadow-[0_1px_0_rgba(23,23,26,0.03),0_28px_60px_-36px_rgba(23,23,26,0.32)]',
        )}
      >
        <img
          src={`/home/${base}-${small}.webp`}
          srcSet={`/home/${base}-${small}.webp ${small}w, /home/${base}-${large}.webp ${large}w`}
          sizes={wide ? `(min-width: 1240px) 1176px, (min-width: 640px) calc(100vw - 64px), ${mobile * 100}vw` : `(min-width: 1240px) 776px, (min-width: 1024px) 64vw, (min-width: 640px) calc(100vw - 64px), ${mobile * 100}vw`}
          width={large}
          height={height}
          alt={alt}
          decoding="async"
          className={cx('block h-auto max-w-none sm:w-full', mobile === 2.5 ? 'w-[250%]' : 'w-[170%]')}
        />
      </div>
      <figcaption className="mt-4 max-w-[70ch] text-[14px] leading-[1.55] text-ink-3">{caption}</figcaption>
    </figure>
  );
}

/* ───────────── ratings ───────────── */

function VerdictScale() {
  return (
    <div>
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">Verdicts and their points</caption>
        <tbody>
          {VERDICTS.map((v) => (
            <tr key={v.key} className="border-b border-line">
              <th scope="row" className="py-3 font-normal">
                <span className="inline-flex rounded-sm border bg-surface px-2 py-0.5 text-[14px] font-medium" style={{ borderColor: v.line, color: v.ink }}>
                  {v.label}
                </span>
              </th>
              <td className="py-3 text-right text-[15px] text-ink-2 tabular-nums">
                {v.points} {v.points === 1 ? 'point' : 'points'}
              </td>
            </tr>
          ))}
          {BROWNIES.map((b) => (
            <tr key={b.key} className="border-b border-line last:border-b-0">
              <th scope="row" className="py-3 font-normal">
                <span className="inline-flex items-center gap-1.5 rounded-sm border border-[#e7d3a6] bg-[#fbf3e1] px-2 py-0.5 text-[14px] font-medium text-[#7a5312]">
                  <CookieIcon className="size-3.5" />
                  {b.label}
                </span>
                <span className="mt-1 block text-[14px] text-ink-3 sm:mt-0 sm:ml-3 sm:inline">{b.hint}</span>
              </th>
              <td className="py-3 text-right text-[15px] text-ink-2 tabular-nums">+1</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ───────────── copy ───────────── */

const ROLES: Array<{ title: string; body: string; link?: { href: string; label: string } }> = [
  {
    title: 'Everyone on a team',
    body: 'Open your team’s board and add your day: each task with the time it took and whether it’s done, plus your attendance for the day. No account or password needed.',
    link: { href: '#teams', label: 'Find your team' },
  },
  {
    title: 'Managers',
    body: 'Sign in to your team’s rating page with your password; it asks on every visit. Rate each day, add brownies and remarks, fix entries, and download the day as a PDF.',
  },
  {
    title: 'The super admin',
    body: 'Creates each manager’s team, link and password, adds or moves employees, and sees every team together with combined stats.',
    link: { href: '/admin', label: 'Super admin sign-in' },
  },
];

const QUESTIONS: Array<{ q: string; a: string }> = [
  {
    q: 'Can I fill in a day I missed?',
    a: 'Team boards are open for today. The super admin can open a few recent days for catching up, and your manager can add or fix any day for you.',
  },
  {
    q: 'Why does the rating page ask for the password every time?',
    a: 'Sign-ins aren’t remembered, on purpose, so a shared computer never stays signed in. Managers and the super admin enter it on every visit, a reload included.',
  },
  { q: 'Can I attach a file to a task?', a: 'Yes, one file per task, up to 10 MB.' },
  { q: 'When does the day change?', a: 'At midnight India time (IST), wherever you are.' },
];

/* ───────────── page ───────────── */

export function Home() {
  const root = useRef<HTMLDivElement>(null);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const t = today();
  const dateLine = useMemo(() => `${weekdayName(t)}, ${longDate(t).replace(/ \d{4}$/, '')}`, [t]);

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

  // The one entrance: the question settles, then the list and the board rise into place.
  useLayoutEffect(() => {
    if (skipMotion() || !root.current) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.fromTo('[data-hero-line]', { opacity: 0, y: 28 }, { opacity: 1, y: 0, duration: 0.85, stagger: 0.09 })
        .fromTo('[data-hero-fade]', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.7, stagger: 0.08 }, 0.3)
        .fromTo('[data-hero-shot]', { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 1 }, 0.5);
    }, root);
    return () => ctx.revert();
  }, []);

  // Each team's meter fills once the real numbers arrive.
  useLayoutEffect(() => {
    if (load.state !== 'ready' || skipMotion() || !root.current) return;
    const ctx = gsap.context(() => {
      gsap.from('[data-meter]', { width: 0, duration: 0.9, ease: 'power2.out', stagger: 0.05, delay: 0.35 });
    }, root);
    return () => ctx.revert();
  }, [load]);

  return (
    <div ref={root} className="home min-h-screen overflow-x-clip bg-paper font-sans text-ink">
      <header className={cx(WRAP, 'flex items-center justify-between py-5')}>
        <a href="/" className="focus-ring flex items-center gap-2.5 rounded-sm">
          <Mark className="size-[22px]" />
          <span className="font-display text-[18px] font-semibold tracking-[-0.02em]">In my arc</span>
        </a>
        <a href="/admin" className="focus-ring rounded-sm text-[14.5px] text-ink-2 hover:text-ink">
          Super admin
        </a>
      </header>

      <main>
        <section className={cx(WRAP, 'pt-12 sm:pt-20')} aria-labelledby="home-title">
          <h1 id="home-title" className="font-display text-[clamp(46px,8.4vw,116px)] leading-[0.93] font-semibold tracking-[-0.047em] text-ink">
            <span data-hero-line className="block">
              What did you
            </span>
            <span data-hero-line className="block">
              work on today?
            </span>
          </h1>

          <div className="mt-10 grid gap-10 sm:mt-14 lg:grid-cols-12 lg:gap-8">
            <div data-hero-fade className="lg:col-span-5">
              <p className="max-w-[34em] text-[18.5px] leading-[1.55] text-ink-2">
                In my arc is {APP.org}’s daily log. You write down your tasks, the time they took and your attendance on your team’s board. Your manager
                reads it and rates the day, and over the weeks those ratings trace your arc.
              </p>
              <p className="mt-6 text-[14.5px] leading-[1.6] text-ink-3">
                Today is {dateLine}. The board moves to a new day at midnight India time.
              </p>
            </div>
            <div className="lg:col-span-7">
              <TeamIndex load={load} onRetry={() => void fetchTeams()} />
            </div>
          </div>
        </section>

        <div data-hero-shot className={cx(WRAP, 'mt-16 overflow-hidden sm:mt-24 sm:overflow-visible')}>
          <Shot
            base="board"
            widths={[1280, 2560]}
            height={1636}
            fade
            wide
            mobile={2.5}
            alt="A team board for Tuesday 10 November: nine people with their tasks, times, statuses and the manager’s verdict for each day, Extraordinary at the top."
            caption={
              <>
                A team’s board at the end of a Tuesday. Everyone adds their own row; once the manager rates the day, the board ranks people by their
                verdict. <span className="whitespace-nowrap">(Sample data.)</span>
              </>
            }
          />
        </div>

        <section className={cx(WRAP, 'mt-24 sm:mt-32')} aria-labelledby="rating-title">
          <div className="grid gap-10 lg:grid-cols-12 lg:gap-8">
            <div className="lg:col-span-5">
              <h2 id="rating-title" className={H2}>
                One verdict for the whole day
              </h2>
              <p className="mt-6 max-w-[38em] text-[17px] leading-[1.6] text-ink-2">
                Managers don’t score each task. They read the day and give it one of five verdicts, and can add a brownie for overtime, for working a
                holiday, or for pulling the team out of trouble.
              </p>
              <p className="mt-4 max-w-[38em] text-[17px] leading-[1.6] text-ink-2">
                A verdict is worth 1 to 5 points, and each brownie adds one more.
              </p>
            </div>
            <div className="lg:col-span-6 lg:col-start-7">
              <VerdictScale />
            </div>
          </div>

        </section>

        <section className={cx(WRAP, 'mt-24 sm:mt-32')} aria-labelledby="arc-title">
          <div className="grid gap-10 lg:grid-cols-12 lg:gap-8">
            <div className="lg:col-span-4">
              <h2 id="arc-title" className={H2}>
                Your arc, week by week
              </h2>
              <p className="mt-6 max-w-[38em] text-[17px] leading-[1.6] text-ink-2">
                Every verdict lands on the Graph, one click from any board. It ranks the team for any week or month, by verdicts or by points, and shows
                how the days have gone week by week, for the whole team or for one person.
              </p>
            </div>
            <Shot
              className="lg:col-span-8"
              base="graph"
              widths={[978, 1956]}
              height={1217}
              mobile={1.7}
              alt="The Graph for a team over four weeks: each person’s verdicts as a coloured bar, ranked, with the team’s verdicts week by week below."
              caption={
                <>
                  Four weeks of a team: everyone’s verdicts as one bar, best first, and the team’s mix week by week.{' '}
                  <span className="whitespace-nowrap">(Sample data.)</span>
                </>
              }
            />
          </div>
        </section>

        <section className={cx(WRAP, 'mt-24 sm:mt-32')} aria-labelledby="roles-title">
          <h2 id="roles-title" className={H2}>
            Who does what
          </h2>
          <div className="mt-10 grid gap-x-8 gap-y-10 md:grid-cols-3">
            {ROLES.map((r) => (
              <div key={r.title} className="border-t border-ink pt-5">
                <h3 className="text-[19px] font-semibold tracking-[-0.01em] text-ink">{r.title}</h3>
                <p className="mt-2.5 max-w-[42ch] text-[16px] leading-[1.6] text-ink-2">{r.body}</p>
                {r.link && (
                  <a href={r.link.href} className={cx(LINK, 'mt-4 inline-block text-[15px] font-medium text-ink')}>
                    {r.link.label}
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className={cx(WRAP, 'mt-24 sm:mt-32')} aria-labelledby="questions-title">
          <div className="grid gap-10 lg:grid-cols-12 lg:gap-8">
            <h2 id="questions-title" className={cx(H2, 'lg:col-span-4')}>
              Questions
            </h2>
            <dl className="grid gap-x-10 gap-y-9 md:grid-cols-2 lg:col-span-8">
              {QUESTIONS.map((item) => (
                <div key={item.q}>
                  <dt className="text-[17px] leading-snug font-semibold text-ink">{item.q}</dt>
                  <dd className="mt-2 text-[16px] leading-[1.6] text-ink-2">{item.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </main>

      <footer className={cx(WRAP, 'mt-24 pb-10 sm:mt-32')}>
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 border-t border-line pt-6 text-[14px] text-ink-3">
          <span className="flex items-center gap-2.5">
            <Mark className="size-4" />
            In my arc, {APP.org}’s daily log
          </span>
          <span className="flex items-center gap-6">
            <a href="#teams" className="focus-ring rounded-sm hover:text-ink">
              Teams
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
