import { useEffect, useMemo, useState } from 'react';
import gsap from 'gsap';
import { DayStepper } from '../components/BoardHeader';
import { BoardTable } from '../components/BoardTable';
import { EditEntryModal } from '../components/EditEntryModal';
import { DownloadIcon, PlusIcon, RefreshIcon } from '../components/icons';
import { LogDayModal, type LogTab } from '../components/LogDayModal';
import { MemberStatsModal } from '../components/MemberStatsModal';
import { StatsPanel } from '../components/StatsPanel';
import { Badge, Button, FieldLabel, Input, cx } from '../components/ui';
import { usePasscode } from '../context/passcode';
import { useToast } from '../context/toast';
import { useDay } from '../hooks/useDay';
import { api, errorText } from '../lib/api';
import { applyHeldOrder, holdOrder, type HeldOrder } from '../lib/board';
import { APP, brownieCount, longDate, today, verdictOf, weekdayName } from '../lib/config';
import { downloadDayReport } from '../lib/report';
import type { Entry, ImportResult, Member, SetupStatus } from '../lib/types';

export function Rating() {
  const { unlocked } = usePasscode();
  return unlocked ? <AdminBoard /> : <AdminGate />;
}

function AdminGate() {
  const { unlock } = usePasscode();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    gsap.fromTo('[data-gate]', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' });
  }, []);

  async function submit() {
    setError(null);
    if (!value) return setError('Enter the passcode.');
    setBusy(true);
    try {
      await unlock(value);
    } catch (e) {
      setError(errorText(e, 'Could not verify.'));
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-5">
      <div data-gate className="w-full max-w-[380px] rounded-md border border-line bg-surface p-6">
        <div className="mb-5 flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-ink-3 uppercase">
          <span className="text-ink">{APP.org}</span>
          <span className="text-line-strong">/</span>
          <span>Ratings</span>
        </div>
        <h1 className="text-[20px] leading-tight font-bold tracking-[-0.02em] text-ink">Admin sign in</h1>
        <p className="mt-1.5 mb-5 text-[12.5px] leading-[1.5] text-ink-3">Ratings and remarks are given here, for any day.</p>
        <FieldLabel htmlFor="gate-pass">Passcode</FieldLabel>
        <Input
          id="gate-pass"
          type="password"
          autoComplete="off"
          value={value}
          placeholder="••••••••"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
        {error && <p className="mt-2 text-[12px] font-medium text-bad">{error}</p>}
        <Button variant="primary" className="mt-4 w-full" onClick={submit} disabled={busy}>
          {busy ? 'Checking…' : 'Continue'}
        </Button>
        <a href="/" className="focus-ring mt-3 block text-center text-[12px] text-ink-3 underline-offset-2 hover:text-ink hover:underline">
          Back to the board
        </a>
      </div>
    </div>
  );
}

/** One-off copy of everything from the old Supabase project. Safe to run more than once. */
function ImportPanel({ onDone, onClose }: { onDone: () => void; onClose?: () => void }) {
  const toast = useToast();
  const [sourceUrl, setSourceUrl] = useState('https://rzhvuincdtsiecnodmsr.supabase.co');
  const [sourceKey, setSourceKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function run() {
    setError(null);
    if (!sourceKey.trim()) return setError('Paste the old project’s anon key.');
    setBusy(true);
    try {
      const r = await api.importHistory(sourceUrl, sourceKey);
      setResult(r);
      toast('History imported.');
      onDone();
    } catch (e) {
      setError(errorText(e, 'The import did not finish.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-md border border-line bg-surface">
      <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-ink">Import history</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-3">
            Copies the team, attendance, entries, verdicts and attachments from the old Supabase project. Running it again updates rows instead of
            duplicating them.
          </p>
        </div>
        {onClose && (
          <Button variant="ghost" size="sm" onClick={onClose}>
            Hide
          </Button>
        )}
      </header>
      <div className="grid gap-4 px-5 py-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <FieldLabel htmlFor="src-url">Old project URL</FieldLabel>
          <Input id="src-url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
        </div>
        <div>
          <FieldLabel htmlFor="src-key" hint="Supabase → Project Settings → API Keys">
            Anon key
          </FieldLabel>
          <Input id="src-key" type="password" autoComplete="off" value={sourceKey} placeholder="eyJhbGciOi…" onChange={(e) => setSourceKey(e.target.value)} />
        </div>
        <Button variant="primary" onClick={run} disabled={busy}>
          {busy ? 'Importing…' : 'Import'}
        </Button>
      </div>
      {(error || result) && (
        <div className="border-t border-line px-5 py-3 text-[12.5px]">
          {error && <p className="font-medium text-bad">{error}</p>}
          {result && (
            <p className="text-ink-2">
              Imported {result.members} members, {result.dayLogs} attendance records, {result.entries} entries and {result.marks} verdicts.
              {result.files.copied + result.files.failed + result.files.skipped > 0 &&
                ` Attachments: ${result.files.copied} copied${result.files.failed ? `, ${result.files.failed} failed` : ''}${
                  result.files.skipped ? `, ${result.files.skipped} waiting for Blob storage` : ''
                }.`}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function AdminBoard() {
  const toast = useToast();
  const { lock } = usePasscode();
  const [date, setDate] = useState(today);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [statsFor, setStatsFor] = useState<Member | null>(null);
  const [building, setBuilding] = useState(false);
  const [dialog, setDialog] = useState<{ open: boolean; tab: LogTab; member: string | null }>({ open: false, tab: 'day', member: null });
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [showImport, setShowImport] = useState(false);
  const day = useDay(date);
  const t = today();
  const [held, setHeld] = useState<HeldOrder | null>(null);

  useEffect(() => {
    api.setup().then(setSetup, () => setSetup(null));
  }, []);

  // Hold the row order from when the day loaded, so judging never reshuffles the table.
  useEffect(() => {
    setHeld(null);
  }, [date]);
  useEffect(() => {
    if (!held && !day.loading && day.groups.length > 0) setHeld(holdOrder(day.groups, date));
  }, [held, day.loading, day.groups, date]);
  const rows = useMemo(() => applyHeldOrder(day.groups, held, date), [day.groups, held, date]);

  const counts = useMemo(() => {
    const reported = day.groups.filter((g) => g.entries.length > 0 || g.dayLog !== null || g.mark);
    return {
      total: reported.length,
      judged: reported.filter((g) => g.mark).length,
      brownies: day.groups.reduce((n, g) => n + brownieCount(g.mark), 0),
    };
  }, [day.groups]);

  const act = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      toast(success);
    } catch (e) {
      toast(errorText(e, 'Action failed.'), 'error');
    }
  };

  const emptyDatabase = setup?.ready && setup.members === 0 && day.roster.length === 0;

  return (
    <div className="flex min-h-screen w-full flex-col gap-6 px-5 pt-8 pb-16 sm:px-8 sm:pt-10">
      <header className="flex flex-col gap-3 border-b border-line pb-4 lg:flex-row lg:flex-nowrap lg:items-center lg:justify-between lg:gap-5">
        <div className="flex min-w-0 items-center gap-x-3 overflow-hidden lg:flex-1">
          <span className="hidden shrink-0 text-[11px] leading-none font-semibold tracking-[0.14em] whitespace-nowrap text-ink-3 uppercase 2xl:inline">
            <span className="text-ink">{APP.org}</span>
            <span className="mx-2 text-line-strong">/</span>
            Ratings
          </span>
          <span className="hidden h-5 w-px shrink-0 bg-line-strong 2xl:block" />
          <h1 className="shrink-0 text-[22px] leading-none font-bold tracking-[-0.03em] whitespace-nowrap text-ink sm:text-[26px] xl:text-[30px]">
            {weekdayName(date)}
          </h1>
          <p className="tnum hidden shrink-0 text-[14px] leading-none font-medium whitespace-nowrap text-ink-2 xl:block">{longDate(date)}</p>
          <span className="shrink-0">
            <Badge tone={counts.total && counts.judged === counts.total ? 'ok' : 'wait'}>
              {counts.judged} / {counts.total} judged
            </Badge>
          </span>
          {counts.brownies > 0 && (
            <span className="hidden shrink-0 xl:inline-flex">
              <Badge tone="mute">
                {counts.brownies} brownie{counts.brownies === 1 ? '' : 's'}
              </Badge>
            </span>
          )}
          {date !== t && (
            <span className="hidden shrink-0 lg:inline-flex">
              <Badge tone="mute">Archive</Badge>
            </span>
          )}
          {held && (
            <span
              title="Rows keep the places they had when this day loaded, so rating a task never reshuffles the table. Refresh to re-rank."
              className="hidden shrink-0 2xl:inline-flex"
            >
              <Badge tone="mute">Order held</Badge>
            </span>
          )}
        </div>
        <div className="-mx-1 flex shrink-0 items-center gap-1.5 overflow-x-auto px-1 pb-1 lg:mx-0 lg:gap-2 lg:overflow-x-visible lg:px-0 lg:pb-0">
          <DayStepper date={date} onDateChange={setDate} />
          {date !== t && (
            <Button className="shrink-0" onClick={() => setDate(t)}>
              Today
            </Button>
          )}
          <Button
            onClick={() => void day.reload({ quiet: true }).then(() => setHeld(null))}
            aria-label="Refresh"
            title="Refresh and re-rank the table"
            className="w-9 shrink-0 px-0"
          >
            <RefreshIcon className={cx('size-4', (day.busy || day.loading) && 'animate-spin')} />
          </Button>
          <Button
            onClick={async () => {
              setBuilding(true);
              try {
                await downloadDayReport(date, day.groups);
                toast('Report downloaded.');
              } catch (e) {
                toast(errorText(e, 'Could not build the report.'), 'error');
              } finally {
                setBuilding(false);
              }
            }}
            disabled={building || day.loading}
            className="shrink-0"
          >
            <DownloadIcon className="size-3.5" />
            {building ? 'Building…' : 'Report'}
          </Button>
          <Button className="shrink-0" onClick={lock}>
            Sign out
          </Button>
          <Button variant="primary" className="shrink-0" onClick={() => setDialog({ open: true, tab: 'day', member: null })}>
            <PlusIcon className="size-3.5" />
            Add task
          </Button>
          <Button className="shrink-0" onClick={() => (window.location.href = '/')}>
            Board
          </Button>
        </div>
      </header>

      {day.error && <div className="rounded-md border border-bad/25 bg-bad-bg px-4 py-3 text-[12.5px] font-medium text-bad">{day.error}</div>}

      {(emptyDatabase || showImport) && (
        <ImportPanel
          onDone={() => {
            void day.reload();
            api.setup().then(setSetup, () => {});
          }}
          onClose={emptyDatabase ? undefined : () => setShowImport(false)}
        />
      )}

      <StatsPanel groups={day.groups} />
      <BoardTable
        groups={rows}
        memberById={day.memberById}
        identity={null}
        canEditTasks
        canJudge
        canRemark
        canAdd
        addLabel="Add task"
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

      <LogDayModal
        open={dialog.open}
        onClose={() => setDialog((d) => ({ ...d, open: false }))}
        members={day.roster}
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

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-[11.5px] text-ink-4">
        <p>Admin — full edit access for any day</p>
        <div className="flex items-center gap-4">
          {!emptyDatabase && !showImport && (
            <button type="button" onClick={() => setShowImport(true)} className="focus-ring underline-offset-2 hover:text-ink hover:underline">
              Import history
            </button>
          )}
          <p className="tnum">all times {APP.timezone.replace('_', ' ')}</p>
        </div>
      </footer>
    </div>
  );
}
