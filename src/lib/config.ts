import type { Attendance, BrownieKey, Brownies, Category, Mark, Status } from './types';

export const APP = { org: 'InnovativeView', title: 'Daily Log', timezone: 'Asia/Kolkata' } as const;

/** Verdicts, brownies and the Review start here. */
export const NEW_SYSTEM_START = '2026-10-01';

export type Tone = 'ok' | 'live' | 'wait' | 'off' | 'bad' | 'mute';

/* ───────────── attendance ───────────── */

export const ATTENDANCE: ReadonlyArray<{ key: Attendance; label: string; short: string; tone: Tone }> = [
  { key: 'full_day', label: 'Full day', short: 'Full day', tone: 'ok' },
  { key: 'wfh', label: 'Work from home', short: 'WFH', tone: 'live' },
  { key: 'half_day', label: 'Half day', short: 'Half day', tone: 'wait' },
  { key: 'week_off', label: 'Week off', short: 'Week off', tone: 'mute' },
  { key: 'leave', label: 'Leave', short: 'Leave', tone: 'off' },
];
export const ATTENDANCE_BY_KEY = Object.fromEntries(ATTENDANCE.map((a) => [a.key, a])) as Record<
  Attendance,
  (typeof ATTENDANCE)[number]
>;

/** Nothing logged on a past day counts as leave (week off at weekends). Today and later: not marked. */
export function presumedAttendance(date: string, todayValue: string, weekend: boolean): Attendance | null {
  return date >= todayValue ? null : weekend ? 'week_off' : 'leave';
}

/* ───────────── task status ───────────── */

export const STATUSES: ReadonlyArray<{ key: Status; label: string; short: string; tone: Tone }> = [
  { key: 'done', label: 'Done', short: 'Done', tone: 'ok' },
  { key: 'not_done', label: 'Not done', short: 'Not done', tone: 'bad' },
  { key: 'rework', label: 'Rework required', short: 'Rework', tone: 'wait' },
];
export const STATUS_BY_KEY = Object.fromEntries(STATUSES.map((s) => [s.key, s])) as Record<Status, (typeof STATUSES)[number]>;

/* ───────────── verdicts ───────────── */

export interface Verdict {
  key: Category;
  label: string;
  short: string;
  rank: number;
  points: number;
  bg: string;
  line: string;
  ink: string;
}

export const VERDICTS: ReadonlyArray<Verdict> = [
  { key: 'extraordinary', label: 'Extraordinary', short: 'Extraordinary', rank: 1, points: 5, bg: '#fae6f0', line: '#e3a8c8', ink: '#86215a' },
  { key: 'over_performed', label: 'Over performed', short: 'Over', rank: 2, points: 4, bg: '#e3edfa', line: '#a3c2e6', ink: '#14447e' },
  { key: 'upto_mark', label: 'Up to the mark', short: 'Up to mark', rank: 3, points: 3, bg: '#e4f5e8', line: '#a3d4ad', ink: '#176234' },
  { key: 'can_be_better', label: 'Can be better', short: 'Can be better', rank: 4, points: 2, bg: '#fcf1d4', line: '#e5cf8c', ink: '#78560a' },
  { key: 'not_upto_mark', label: 'Not up to the mark', short: 'Not up to mark', rank: 5, points: 1, bg: '#fce5e2', line: '#eeb0a8', ink: '#8c2317' },
];
const VERDICT_BY_KEY = Object.fromEntries(VERDICTS.map((v) => [v.key, v])) as Record<Category, Verdict>;

export function verdictOf(key: string | null | undefined): Verdict | null {
  return key && key in VERDICT_BY_KEY ? VERDICT_BY_KEY[key as Category] : null;
}

/* ───────────── brownies ───────────── */

export const BROWNIES: ReadonlyArray<{ key: BrownieKey; label: string; hint: string }> = [
  { key: 'overtime', label: 'Overtime', hint: 'Stayed well beyond the day' },
  { key: 'holiday', label: 'Holiday', hint: 'Worked on a day off' },
  { key: 'hero', label: 'Hero', hint: 'Pulled the team out of trouble' },
];
export const NO_BROWNIES: Brownies = { overtime: false, holiday: false, hero: false };
export const POINTS_PER_BROWNIE = 1;

export function brownieFlags(mark: Partial<Brownies> | null | undefined): Brownies {
  return { overtime: !!mark?.overtime, holiday: !!mark?.holiday, hero: !!mark?.hero };
}

export function brownieCount(mark: Partial<Brownies> | null | undefined): number {
  return BROWNIES.reduce((n, b) => n + (mark?.[b.key] ? 1 : 0), 0);
}

/** Verdict points (1–5) plus one per brownie. */
export function markPoints(mark: Mark | null | undefined): number {
  const v = verdictOf(mark?.category);
  return v ? v.points + brownieCount(mark) * POINTS_PER_BROWNIE : 0;
}

/* ───────────── formatting ───────────── */

export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes == null || minutes < 0) return '—';
  if (minutes === 0) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

/* ───────────── dates (YYYY-MM-DD, team time zone) ───────────── */

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP.timezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function today(): string {
  return dayFormat.format(new Date());
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

export function parseDay(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** "Tuesday" */
export function weekdayName(date: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(parseDay(date));
}

/** "27 October 2026" */
export function longDate(date: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(parseDay(date));
}

/** "27 Oct" */
export function shortDate(date: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(parseDay(date));
}

/** "13:40" in the team time zone */
export function timeOf(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: APP.timezone }).format(new Date(iso));
}

export function isWeekend(date: string): boolean {
  const day = parseDay(date).getUTCDay();
  return day === 0 || day === 6;
}

/** Monday of the week */
export function weekStart(date: string): string {
  const back = (parseDay(date).getUTCDay() + 6) % 7;
  return addDays(date, -back);
}

export function monthStart(date: string): string {
  const [y, m] = date.split('-');
  return `${y}-${m}-01`;
}

export function addMonths(monthFirst: string, months: number): string {
  const [y, m] = monthFirst.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = total % 12;
  return `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

/** "Nov" */
export function monthShort(date: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(parseDay(date));
}
