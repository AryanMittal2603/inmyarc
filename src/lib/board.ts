import { VERDICTS, brownieCount, isWeekend, presumedAttendance, today, verdictOf } from './config';
import type { Attendance, Category, DayLog, Entry, Mark, Member } from './types';

export interface Group {
  member: Member;
  dayLog: DayLog | null;
  entries: Entry[];
  mark: Mark | null;
  /** Attendance the day counts as when nothing was logged (past days only). */
  presumed: Attendance | null;
  /** Shared place by verdict; null until judged. */
  rank: number | null;
}

/**
 * Rows for one day: every active member (plus anyone inactive who has something that day),
 * ordered by verdict, then brownies, then name. Everyone in a verdict shares the place.
 */
export function buildGroups(members: Member[], dayLogs: DayLog[], entries: Entry[], marks: Mark[], date: string): Group[] {
  const presumed = presumedAttendance(date, today(), isWeekend(date));
  const markBy = new Map(marks.map((m) => [m.member_id, m]));
  const logBy = new Map(dayLogs.map((l) => [l.member_id, l]));
  const entriesBy = new Map<string, Entry[]>();
  for (const e of entries) {
    const list = entriesBy.get(e.member_id);
    if (list) list.push(e);
    else entriesBy.set(e.member_id, [e]);
  }

  const rows = members
    .filter((m) => m.active || logBy.has(m.id) || entriesBy.has(m.id))
    .map((member) => {
      const memberEntries = entriesBy.get(member.id) ?? [];
      const dayLog = logBy.get(member.id) ?? null;
      return {
        member,
        dayLog,
        entries: memberEntries,
        mark: markBy.get(member.id) ?? null,
        presumed: !dayLog && memberEntries.length === 0 ? presumed : null,
      };
    });

  const brownies = (g: (typeof rows)[number]) => brownieCount(g.mark);
  const verdictRank = (g: (typeof rows)[number]) => verdictOf(g.mark?.category)?.rank ?? Infinity;
  const sorted = [...rows].sort(
    (a, b) => verdictRank(a) - verdictRank(b) || brownies(b) - brownies(a) || a.member.name.localeCompare(b.member.name),
  );
  const places = [...new Set(sorted.map(verdictRank).filter(Number.isFinite))].sort((a, b) => a - b);
  return sorted.map((g) => {
    const r = verdictRank(g);
    return { ...g, rank: Number.isFinite(r) ? places.indexOf(r) + 1 : null };
  });
}

/* The admin page keeps rows where they were when the day loaded, so judging never reshuffles. */

export interface HeldOrder {
  date: string;
  ids: string[];
  ranks: Record<string, number | null>;
}

export function holdOrder(groups: Group[], date: string): HeldOrder {
  return { date, ids: groups.map((g) => g.member.id), ranks: Object.fromEntries(groups.map((g) => [g.member.id, g.rank])) };
}

export function applyHeldOrder(groups: Group[], held: HeldOrder | null, date: string): Group[] {
  if (!held || held.date !== date) return groups;
  const position = new Map(held.ids.map((id, i) => [id, i]));
  return [...groups]
    .sort((a, b) => (position.get(a.member.id) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.member.id) ?? Number.MAX_SAFE_INTEGER))
    .map((g) => (g.member.id in held.ranks ? { ...g, rank: held.ranks[g.member.id] } : g));
}

/** Numbers for the stat tiles above the table. */
export function dayTotals(groups: Group[]) {
  let reported = 0;
  let working = 0;
  let off = 0;
  let tasks = 0;
  let done = 0;
  let notDone = 0;
  let rework = 0;
  let minutes = 0;
  let judged = 0;
  let brownies = 0;
  const byCategory = Object.fromEntries(VERDICTS.map((v) => [v.key, 0])) as Record<Category, number>;
  const att: Record<Attendance, number> = { full_day: 0, wfh: 0, half_day: 0, week_off: 0, leave: 0 };

  for (const g of groups) {
    if (g.dayLog !== null || g.entries.length > 0 || g.mark) reported += 1;
    const a = g.dayLog?.attendance ?? g.presumed;
    if (a) {
      att[a] += 1;
      if (a === 'week_off' || a === 'leave') off += 1;
      else working += 1;
    }
    for (const e of g.entries) {
      tasks += 1;
      if (e.status === 'done') done += 1;
      else if (e.status === 'not_done') notDone += 1;
      else rework += 1;
      if (e.minutes) minutes += e.minutes;
    }
    if (g.mark) {
      judged += 1;
      byCategory[g.mark.category] += 1;
      brownies += brownieCount(g.mark);
    }
  }

  return {
    reported,
    working,
    off,
    tasks,
    done,
    notDone,
    rework,
    minutes,
    judged,
    brownies,
    byCategory,
    att,
    total: groups.length,
    pct: groups.length ? Math.round((reported / groups.length) * 100) : 0,
    donePct: tasks ? Math.round((done / tasks) * 100) : 0,
  };
}

/** Numbers for the PDF summary line (only explicit attendance counts here, as in the original). */
export function reportTotals(groups: Group[]) {
  let reported = 0;
  let working = 0;
  let off = 0;
  let tasks = 0;
  let done = 0;
  let open = 0;
  let minutes = 0;
  let judged = 0;
  let brownies = 0;
  for (const g of groups) {
    if (g.mark) {
      judged += 1;
      brownies += brownieCount(g.mark);
    }
    if (g.dayLog !== null || g.entries.length > 0) reported += 1;
    if (g.dayLog) {
      if (g.dayLog.attendance === 'week_off' || g.dayLog.attendance === 'leave') off += 1;
      else working += 1;
    }
    for (const e of g.entries) {
      tasks += 1;
      if (e.status === 'done') done += 1;
      else open += 1;
      if (e.minutes) minutes += e.minutes;
    }
  }
  return { reported, total: groups.length, working, off, tasks, done, open, minutes, judged, brownies };
}
