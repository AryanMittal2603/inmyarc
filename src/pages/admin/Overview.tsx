import { useCallback, useEffect, useMemo, useState } from 'react';
import { DayStepper, TableSkeleton } from '../../components/BoardHeader';
import { BoardTable } from '../../components/BoardTable';
import { EditEntryModal } from '../../components/EditEntryModal';
import { ChartIcon, DownloadIcon, PlusIcon, RefreshIcon } from '../../components/icons';
import { LogDayModal, type LogTab } from '../../components/LogDayModal';
import { MemberStatsModal } from '../../components/MemberStatsModal';
import { ReviewModal } from '../../components/ReviewModal';
import { StatsPanel } from '../../components/StatsPanel';
import { Badge, Button, Select, cx } from '../../components/ui';
import { useToast } from '../../context/toast';
import { useDay } from '../../hooks/useDay';
import { errorText } from '../../lib/api';
import { applyHeldOrder, holdOrder, type Group, type HeldOrder } from '../../lib/board';
import { brownieCount, longDate, today, verdictOf, weekdayName } from '../../lib/config';
import { downloadDayReport } from '../../lib/report';
import { links } from '../../lib/routes';
import type { Entry, Member, Team } from '../../lib/types';

/** '' = every team, 'none' = people without a team, otherwise a manager id. */
type TeamFilter = string;

interface TeamSummary {
  key: TeamFilter;
  team: Team | null;
  people: number;
  reported: number;
  judged: number;
  brownies: number;
}

function summarize(groups: Group[], teams: Team[]): TeamSummary[] {
  const rows: TeamSummary[] = teams.map((team) => ({ key: team.id, team, people: 0, reported: 0, judged: 0, brownies: 0 }));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const none: TeamSummary = { key: 'none', team: null, people: 0, reported: 0, judged: 0, brownies: 0 };
  for (const g of groups) {
    const row = (g.member.manager_id && byKey.get(g.member.manager_id)) || none;
    if (g.member.active) row.people += 1;
    if (g.dayLog || g.entries.length > 0) row.reported += 1;
    if (g.mark) row.judged += 1;
    row.brownies += brownieCount(g.mark);
  }
  return none.people || none.reported ? [...rows, none] : rows;
}

export function OverviewTab({ onSignedOut }: { onSignedOut: () => void }) {
  const toast = useToast();
  const [date, setDate] = useState(today);
  const [filter, setFilter] = useState<TeamFilter>('');
  const [editing, setEditing] = useState<Entry | null>(null);
  const [statsFor, setStatsFor] = useState<Member | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [building, setBuilding] = useState(false);
  const [dialog, setDialog] = useState<{ open: boolean; tab: LogTab; member: string | null }>({ open: false, tab: 'day', member: null });
  const [held, setHeld] = useState<HeldOrder | null>(null);
  const day = useDay(date, '*');
  const t = today();

  useEffect(() => {
    if (day.signedOut) onSignedOut();
  }, [day.signedOut, onSignedOut]);

  const teamById = useMemo(() => new Map(day.teams.map((team) => [team.id, team])), [day.teams]);
  const include = useCallback(
    (m: Member) => (filter === '' ? true : filter === 'none' ? !m.manager_id : m.manager_id === filter),
    [filter],
  );
  const groups = useMemo(() => day.groups.filter((g) => include(g.member)), [day.groups, include]);
  const roster = useMemo(() => day.roster.filter(include), [day.roster, include]);
  const summary = useMemo(() => summarize(day.groups, day.teams), [day.groups, day.teams]);
  const current = filter && filter !== 'none' ? teamById.get(filter) ?? null : null;
  const scopeLabel = filter === '' ? 'All teams' : filter === 'none' ? 'No team' : current ? `${current.name}’s team` : 'Team';

  // Keep rows where they were when the day (or filter) loaded, so judging never reshuffles.
  useEffect(() => setHeld(null), [date, filter]);
  useEffect(() => {
    if (!held && !day.loading && groups.length > 0) setHeld(holdOrder(groups, date));
  }, [held, day.loading, groups, date]);
  const rows = useMemo(() => applyHeldOrder(groups, held, date), [groups, held, date]);

  const counts = useMemo(() => {
    const reported = groups.filter((g) => g.entries.length > 0 || g.dayLog !== null || g.mark);
    return { total: reported.length, judged: reported.filter((g) => g.mark).length };
  }, [groups]);

  const act = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      toast(success);
    } catch (e) {
      toast(errorText(e, 'Action failed.'), 'error');
    }
  };

  const teamOf = useCallback((m: Member) => (m.manager_id ? `${teamById.get(m.manager_id)?.name ?? 'Unknown'}’s team` : null), [teamById]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-[22px] leading-none font-bold tracking-[-0.03em] text-ink sm:text-[26px]">{weekdayName(date)}</h2>
          <p className="tnum text-[14px] leading-none font-medium text-ink-2">{longDate(date)}</p>
          <Badge tone={counts.total && counts.judged === counts.total ? 'ok' : 'wait'}>
            {counts.judged} / {counts.total} judged
          </Badge>
          {date !== t && <Badge tone="mute">Archive</Badge>}
        </div>
        <div className="-mx-1 flex shrink-0 items-center gap-1.5 overflow-x-auto px-1 pb-1 lg:mx-0 lg:gap-2 lg:overflow-x-visible lg:px-0 lg:pb-0">
          <DayStepper date={date} onDateChange={setDate} />
          {date !== t && (
            <Button className="shrink-0" onClick={() => setDate(t)}>
              Today
            </Button>
          )}
          <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-auto min-w-[190px]" aria-label="Show team">
            <option value="">All teams</option>
            {day.teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}’s team{team.active ? '' : ' (off)'}
              </option>
            ))}
            <option value="none">No team</option>
          </Select>
          <Button
            onClick={() => void day.reload({ quiet: true }).then(() => setHeld(null))}
            aria-label="Refresh"
            title="Refresh and re-rank the table"
            size="icon"
            className="shrink-0"
          >
            <RefreshIcon className={cx('size-4', (day.busy || day.loading) && 'animate-spin')} />
          </Button>
          <Button className="shrink-0" onClick={() => setReviewOpen(true)}>
            <ChartIcon className="size-3.5" />
            Graph
          </Button>
          <Button
            className="shrink-0"
            disabled={building || day.loading}
            onClick={async () => {
              setBuilding(true);
              try {
                await downloadDayReport(date, rows, { label: scopeLabel, file: current ? current.slug : filter === 'none' ? 'no-team' : 'all-teams' });
                toast('Report downloaded.');
              } catch (e) {
                toast(errorText(e, 'Could not build the report.'), 'error');
              } finally {
                setBuilding(false);
              }
            }}
          >
            <DownloadIcon className="size-3.5" />
            {building ? 'Building…' : 'Report'}
          </Button>
          <Button variant="primary" className="shrink-0" disabled={roster.length === 0} onClick={() => setDialog({ open: true, tab: 'day', member: null })}>
            <PlusIcon className="size-3.5" />
            Add task
          </Button>
        </div>
      </div>

      {day.error && <div className="rounded-md border border-bad/25 bg-bad-bg px-4 py-3 text-[12.5px] font-medium text-bad">{day.error}</div>}

      {summary.length > 0 && (
        <section className="overflow-x-auto rounded-md border border-line bg-surface">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-paper text-[10.5px] font-semibold tracking-[0.1em] text-ink-3 uppercase">
                <th className="px-4 py-2.5">Team</th>
                <th className="px-3 py-2.5">Employees</th>
                <th className="px-3 py-2.5">Logged</th>
                <th className="px-3 py-2.5">Judged</th>
                <th className="px-3 py-2.5">Brownies</th>
                <th className="px-4 py-2.5 text-right">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => {
                const on = filter === s.key;
                const share = s.people ? Math.min(s.reported / s.people, 1) : 0;
                return (
                  <tr
                    key={s.key}
                    onClick={() => setFilter(on ? '' : s.key)}
                    className={cx('cursor-pointer border-b border-line transition-colors last:border-b-0', on ? 'bg-live-bg/60' : 'hover:bg-paper')}
                    aria-selected={on}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold text-ink">{s.team ? `${s.team.name}’s team` : 'No team'}</span>
                        {s.team && !s.team.active && <Badge tone="mute">Off</Badge>}
                        {on && <Badge tone="live">Showing</Badge>}
                      </div>
                    </td>
                    <td className="tnum px-3 py-2.5 text-[13px] text-ink-2">{s.people}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className="block h-[4px] w-16 overflow-hidden rounded-full bg-line">
                          <span className="block h-full rounded-full bg-ok" style={{ width: `${share * 100}%` }} />
                        </span>
                        <span className="tnum text-[12.5px] text-ink-2">
                          {s.reported} / {s.people}
                        </span>
                      </div>
                    </td>
                    <td className="tnum px-3 py-2.5 text-[12.5px] text-ink-2">
                      {s.judged} / {s.reported}
                    </td>
                    <td className="tnum px-3 py-2.5 text-[12.5px] text-ink-2">{s.brownies || '–'}</td>
                    <td className="px-4 py-2.5 text-right">
                      {s.team?.active && (
                        <a
                          href={links.rating(s.team.slug)}
                          onClick={(e) => e.stopPropagation()}
                          className="focus-ring rounded-xs text-[12px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
                        >
                          Manager page
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <StatsPanel groups={groups} />

      {day.loading && day.groups.length === 0 ? (
        <TableSkeleton />
      ) : groups.length === 0 ? (
        <div className="rounded-md border border-line-strong bg-surface px-4 py-6 text-center text-[12.5px] text-ink-3">
          {day.members.length === 0 ? 'No one has been added yet. Add managers and their employees on the other tabs.' : `No one in ${scopeLabel.toLowerCase()} for this day.`}
        </div>
      ) : (
        <BoardTable
          groups={rows}
          memberById={day.memberById}
          identity={null}
          canEditTasks
          canJudge
          canRemark
          canAdd
          addLabel="Add task"
          teamOf={filter === '' ? teamOf : undefined}
          onStatus={(id, status) => void act(() => day.setStatus(id, status, null), 'Status updated.')}
          onMark={(memberId, category, flags) =>
            void act(
              () => day.setMark(memberId, category, flags),
              category ? `${day.memberById.get(memberId)?.name ?? 'Day'} — ${(verdictOf(category)?.label ?? category).toLowerCase()}.` : 'Verdict cleared.',
            )
          }
          onEdit={setEditing}
          onRemarks={(id, text) => void act(() => day.setRemarks(id, text), text.trim() ? 'Remark saved.' : 'Remark cleared.')}
          onDelete={(id) => void act(() => day.deleteEntry(id), 'Entry removed.')}
          onAttendance={(memberId, attendance) => void act(() => day.setAttendance(memberId, attendance), 'Day updated.')}
          onMember={setStatsFor}
          onAddFor={(memberId) => setDialog({ open: true, tab: 'day', member: memberId })}
        />
      )}

      <LogDayModal
        open={dialog.open}
        onClose={() => setDialog((d) => ({ ...d, open: false }))}
        members={roster}
        dayLogs={day.dayLogs}
        date={date}
        onDateChange={setDate}
        identity={dialog.member}
        onIdentity={() => {}}
        initialTab={dialog.tab}
        initialMember={dialog.member}
        onSubmitDay={day.submitDay}
        onAssign={day.assignTask}
      />
      {statsFor && (
        <MemberStatsModal
          key={statsFor.id}
          member={statsFor}
          onClose={() => setStatsFor(null)}
          markToday={day.groups.find((g) => g.member.id === statsFor.id)?.mark ?? null}
          team="*"
        />
      )}
      {editing && (
        <EditEntryModal
          key={editing.id}
          entry={editing}
          owner={day.memberById.get(editing.member_id) ?? null}
          members={day.memberById}
          identity={null}
          onClose={() => setEditing(null)}
          onSave={day.updateEntry}
          onDelete={day.deleteEntry}
        />
      )}
      <ReviewModal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        members={roster}
        identity={null}
        team="*"
        include={filter === '' ? undefined : include}
        title={`Review — ${scopeLabel}`}
      />
    </div>
  );
}
