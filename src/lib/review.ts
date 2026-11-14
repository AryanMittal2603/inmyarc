import { BROWNIES, VERDICTS, addDays, brownieCount, markPoints, monthStart, shortDate, today, verdictOf, weekStart } from './config';
import type { BrownieKey, Category, Entry, Mark, Member } from './types';

/** One member-day in the history: tasks and minutes logged, and the verdict if any. */
export interface HistoryRow {
  member_id: string;
  log_date: string;
  tasks: number;
  minutes: number;
  mark: Mark | null;
}

export type PeriodMode = 'week' | 'month';
export type RankMode = 'verdicts' | 'points';

export interface Tally {
  days: number;
  tasks: number;
  minutes: number;
  judged: number;
  brownies: number;
  points: number;
  byBrownie: Record<BrownieKey, number>;
  byCategory: Record<Category, number>;
}

export function emptyTally(): Tally {
  return {
    days: 0,
    tasks: 0,
    minutes: 0,
    judged: 0,
    brownies: 0,
    points: 0,
    byBrownie: Object.fromEntries(BROWNIES.map((b) => [b.key, 0])) as Record<BrownieKey, number>,
    byCategory: Object.fromEntries(VERDICTS.map((v) => [v.key, 0])) as Record<Category, number>,
  };
}

/** Builds the per member-day rows from raw entries and marks (days with only a verdict count too). */
export function historyRows(entries: Entry[], marks: Mark[]): HistoryRow[] {
  const markBy = new Map(marks.map((m) => [`${m.member_id}:${m.log_date}`, m]));
  const rows = new Map<string, HistoryRow>();
  for (const e of entries) {
    const key = `${e.member_id}:${e.log_date}`;
    const row = rows.get(key) ?? { member_id: e.member_id, log_date: e.log_date, tasks: 0, minutes: 0, mark: markBy.get(key) ?? null };
    row.tasks += 1;
    row.minutes += e.minutes ?? 0;
    rows.set(key, row);
  }
  for (const m of marks) {
    const key = `${m.member_id}:${m.log_date}`;
    if (!rows.has(key)) rows.set(key, { member_id: m.member_id, log_date: m.log_date, tasks: 0, minutes: 0, mark: m });
  }
  return [...rows.values()].sort((a, b) => a.log_date.localeCompare(b.log_date));
}

export function periodKey(date: string, mode: PeriodMode): string {
  return mode === 'week' ? weekStart(date) : monthStart(date);
}

function addRow(t: Tally, row: HistoryRow): Tally {
  t.days += 1;
  t.tasks += row.tasks;
  t.minutes += row.minutes;
  if (row.mark && verdictOf(row.mark.category)) {
    t.judged += 1;
    t.byCategory[row.mark.category] += 1;
    for (const b of BROWNIES) if (row.mark[b.key]) t.byBrownie[b.key] += 1;
    t.brownies += brownieCount(row.mark);
    t.points += markPoints(row.mark);
  }
  return t;
}

export function tally(rows: HistoryRow[]): Tally {
  return rows.reduce(addRow, emptyTally());
}

/** More of the better verdicts wins; for "can be better" and "not up to the mark", fewer wins. Then brownies. */
function compareByVerdicts(a: Tally, b: Tally): number {
  for (const v of VERDICTS) {
    const diff = b.byCategory[v.key] - a.byCategory[v.key];
    if (diff !== 0) return v.rank >= 4 ? -diff : diff;
  }
  return b.brownies - a.brownies;
}

export interface Standing {
  member: Member;
  tally: Tally;
  place: number | null;
}

/** Ranked list with shared places for identical records; the unjudged sit at the bottom without a place. */
export function standings(members: Member[], rowsByMember: Map<string, HistoryRow[]>, mode: RankMode): Standing[] {
  const list = members
    .map((member) => ({ member, tally: tally(rowsByMember.get(member.id) ?? []) }))
    .sort(
      (a, b) =>
        Number(a.tally.judged === 0) - Number(b.tally.judged === 0) ||
        (mode === 'points' ? b.tally.points - a.tally.points : compareByVerdicts(a.tally, b.tally)) ||
        a.member.name.localeCompare(b.member.name),
    );
  const signature = (t: Tally) => (mode === 'points' ? String(t.points) : `${VERDICTS.map((v) => t.byCategory[v.key]).join('-')}:${t.brownies}`);
  let place = 0;
  let last: string | null = null;
  let seen = 0;
  return list.map((s) => {
    if (!s.tally.judged) return { ...s, place: null };
    seen += 1;
    const sig = signature(s.tally);
    if (sig !== last) {
      place = seen;
      last = sig;
    }
    return { ...s, place };
  });
}

/** Calendar square colour for a verdict (warm grey when the day was not judged). */
export function verdictColor(category: string | null | undefined): string {
  return verdictOf(category)?.bg ?? '#eceae5';
}

/** Review covers the last 12 weeks, or the last 6 months. */
export function reviewStart(mode: PeriodMode): string {
  return mode === 'week' ? weekStart(addDays(today(), -7 * 11)) : monthStart(addDays(today(), -31 * 5));
}

export function periodLabel(key: string, mode: PeriodMode): string {
  return mode === 'week'
    ? shortDate(key)
    : new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(new Date(`${key}T12:00:00Z`));
}
