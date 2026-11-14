import { useCallback, useEffect, useRef, useState } from 'react';
import { BoardHeader, TableSkeleton } from '../components/BoardHeader';
import { BoardTable } from '../components/BoardTable';
import { EditEntryModal } from '../components/EditEntryModal';
import { LogDayModal, type LogTab } from '../components/LogDayModal';
import { MemberStatsModal } from '../components/MemberStatsModal';
import { ReviewModal } from '../components/ReviewModal';
import { SetupNotice } from '../components/SetupNotice';
import { StatsPanel } from '../components/StatsPanel';
import { Button, cx } from '../components/ui';
import { useToast } from '../context/toast';
import { useDay } from '../hooks/useDay';
import { APP, timeOf, today } from '../lib/config';
import type { Entry, Member } from '../lib/types';

const IDENTITY_KEY = 'iv.daily-log.identity';

function readIdentity(): string | null {
  try {
    return localStorage.getItem(IDENTITY_KEY);
  } catch {
    return null;
  }
}

/** The public board at "/": everyone logs their day here; edits are open for the editable window only. */
export function Board() {
  const toast = useToast();
  const [date, setDate] = useState(today);
  const [identity, setIdentity] = useState<string | null>(readIdentity);
  const [dialog, setDialog] = useState<{ open: boolean; tab: LogTab; member: string | null }>({ open: false, tab: 'day', member: null });
  const [reviewOpen, setReviewOpen] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [statsFor, setStatsFor] = useState<Member | null>(null);
  const day = useDay(date);
  const isToday = date === today();

  // Follow the calendar: if the board shows today and the day rolls over, move with it.
  const lastToday = useRef(today());
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = today();
      if (now === lastToday.current) return;
      const previous = lastToday.current;
      lastToday.current = now;
      setDate((d) => (d === previous ? now : d));
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const rememberIdentity = useCallback((memberId: string) => {
    setIdentity(memberId);
    try {
      localStorage.setItem(IDENTITY_KEY, memberId);
    } catch {
      // private mode: remember for this visit only
    }
  }, []);

  const act = useCallback(
    async (action: () => Promise<unknown>, success: string) => {
      try {
        await action();
        toast(success);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Action failed.', 'error');
      }
    },
    [toast],
  );

  const locked = day.locked;
  const ready = !day.needsSetup;

  return (
    <div className="flex min-h-screen w-full flex-col gap-6 px-5 pt-8 pb-16 sm:px-8 sm:pt-10">
      <BoardHeader
        date={date}
        onDateChange={setDate}
        onAdd={() => setDialog({ open: true, tab: 'day', member: identity })}
        onGraph={() => setReviewOpen(true)}
        locked={locked}
        canAdd={!locked && ready}
        onRefresh={() => void day.reload({ quiet: true })}
        busy={day.busy || day.loading}
        identity={identity}
      />

      {day.error && (
        <div className="rounded-md border border-off/25 bg-off-bg px-4 py-3">
          <p className="text-[12.5px] leading-[1.5] font-medium text-off">{day.error}</p>
        </div>
      )}

      {!ready && <SetupNotice />}

      {ready && !day.loading && !day.error && day.roster.length === 0 && (
        <div className="rounded-md border border-line-strong bg-surface px-4 py-3">
          <p className="text-[12.5px] leading-[1.5] text-ink-2">
            No team members yet. Sign in at <code className="rounded-xs bg-mute-bg px-1 py-0.5 font-mono text-[11.5px]">/rating</code> and use{' '}
            <b>Import the team</b>, or add rows to the <code className="rounded-xs bg-mute-bg px-1 py-0.5 font-mono text-[11.5px]">members</code> table,
            then refresh.
          </p>
        </div>
      )}

      {ready && <StatsPanel groups={day.groups} />}

      {ready &&
        (day.loading ? (
          <TableSkeleton />
        ) : (
          <BoardTable
            groups={day.groups}
            memberById={day.memberById}
            identity={identity}
            canEditTasks={!locked}
            canJudge={false}
            canRemark={!locked}
            canAdd={!locked}
            onEdit={setEditing}
            onMark={() => {}}
            onStatus={(id, status) => void act(() => day.setStatus(id, status, identity), 'Status updated.')}
            onRemarks={(id, text) => void act(() => day.setRemarks(id, text), text.trim() ? 'Remark saved.' : 'Remark cleared.')}
            onDelete={(id) => void act(() => day.deleteEntry(id), 'Entry removed.')}
            onAttendance={(memberId, attendance) => void act(() => day.setAttendance(memberId, attendance), 'Day updated.')}
            onMember={setStatsFor}
            onAddFor={(memberId) => setDialog({ open: true, tab: memberId === identity ? 'day' : 'assign', member: memberId })}
          />
        ))}

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-[11.5px] text-ink-4">
        <p>
          {APP.org} internal · all times {APP.timezone.replace('_', ' ')}
        </p>
        <p className="tnum flex items-center gap-2">
          {isToday ? 'Live' : 'Archived day'}
          <span className="text-line-strong">/</span>
          synced {timeOf(day.syncedAt)}
        </p>
      </footer>

      <div className={cx('fixed right-5 bottom-5 sm:hidden', (locked || !ready) && 'hidden')}>
        <Button
          variant="primary"
          onClick={() => setDialog({ open: true, tab: 'day', member: identity })}
          className="shadow-[0_8px_24px_-8px_rgba(23,23,26,0.4)]"
        >
          Add entry
        </Button>
      </div>

      {statsFor && (
        <MemberStatsModal
          key={statsFor.id}
          member={statsFor}
          onClose={() => setStatsFor(null)}
          markToday={day.groups.find((g) => g.member.id === statsFor.id)?.mark ?? null}
        />
      )}
      {editing && (
        <EditEntryModal
          key={editing.id}
          entry={editing}
          owner={day.memberById.get(editing.member_id) ?? null}
          members={day.memberById}
          identity={identity}
          onClose={() => setEditing(null)}
          onSave={day.updateEntry}
          onDelete={day.deleteEntry}
        />
      )}
      <ReviewModal open={reviewOpen} onClose={() => setReviewOpen(false)} members={day.roster} identity={identity} />
      <LogDayModal
        open={dialog.open}
        onClose={() => setDialog((d) => ({ ...d, open: false }))}
        members={day.roster}
        dayLogs={day.dayLogs}
        date={date}
        onDateChange={setDate}
        identity={identity}
        onIdentity={rememberIdentity}
        initialTab={dialog.tab}
        initialMember={dialog.member}
        minDate={day.openFrom ?? today()}
        onSubmitDay={day.submitDay}
        onAssign={day.assignTask}
      />
    </div>
  );
}
