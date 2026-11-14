import { useCallback, useEffect, useMemo, useState } from 'react';
import { DayStepper } from '../components/BoardHeader';
import { BoardTable } from '../components/BoardTable';
import { EditEntryModal } from '../components/EditEntryModal';
import { ChartIcon, DownloadIcon, PlusIcon, RefreshIcon } from '../components/icons';
import { LogDayModal, type LogTab } from '../components/LogDayModal';
import { MemberStatsModal } from '../components/MemberStatsModal';
import { ReviewModal } from '../components/ReviewModal';
import { SetupNotice } from '../components/SetupNotice';
import { ButtonLink, PageMessage, SignInCard } from '../components/SignInCard';
import { StatsPanel } from '../components/StatsPanel';
import { Badge, Button, cx } from '../components/ui';
import { useToast } from '../context/toast';
import { useDay } from '../hooks/useDay';
import { useSession } from '../hooks/useSession';
import { errorText, isSignedOut } from '../lib/api';
import { applyHeldOrder, holdOrder, type HeldOrder } from '../lib/board';
import { APP, brownieCount, longDate, today, verdictOf, weekdayName } from '../lib/config';
import { downloadDayReport } from '../lib/report';
import { links } from '../lib/routes';
import type { Entry, Member } from '../lib/types';

/** /rating/<slug>: the team's manager (or the super admin) rates days and edits any day. */
export function ManagerPage({ slug }: { slug: string }) {
  const session = useSession(slug);

  useEffect(() => {
    document.title = session.team ? `Ratings — ${session.team.name}` : `Ratings — ${APP.org}`;
  }, [session.team]);

  if (session.loading) return <div className="min-h-screen" aria-busy="true" />;
  if (session.needsSetup) {
    return (
      <div className="mx-auto flex min-h-screen max-w-[760px] flex-col justify-center px-5 py-10">
        <SetupNotice />
      </div>
    );
  }
  if (session.error) {
    return (
      <PageMessage title="Couldn’t check your sign-in" action={<Button onClick={() => void session.refresh()}>Try again</Button>}>
        {session.error}
      </PageMessage>
    );
  }
  if (!session.team) {
    return (
      <PageMessage
        title="This team link isn’t active"
        action={
          <>
            <ButtonLink href="/">See all teams</ButtonLink>
            {session.admin && <ButtonLink href="/admin">Super admin</ButtonLink>}
          </>
        }
      >
        Nothing is set up at <b>{links.rating(slug)}</b>, or the team was switched off. The super admin can check it on the Managers page.
      </PageMessage>
    );
  }

  const ownTeam = session.manager?.slug === slug;
  if (!ownTeam && !session.admin) {
    return (
      <SignInCard
        area="Ratings"
        title={session.team.name}
        username={slug}
        description="Enter your password to rate your team’s days and edit any day. It’s asked each time you open this page. The super admin can use theirs."
        onSubmit={session.signInManager}
        footer={
          <a href={links.board(slug)} className="focus-ring rounded-xs underline-offset-2 hover:text-ink hover:underline">
            Back to the team board
          </a>
        }
      />
    );
  }

  return (
    <ManagerBoard
      slug={slug}
      teamName={session.team.name}
      ownTeam={ownTeam}
      onSignOut={() => void session.signOut()}
      onSignedOut={() => void session.refresh()}
    />
  );
}

function ManagerBoard({
  slug,
  teamName,
  ownTeam,
  onSignOut,
  onSignedOut,
}: {
  slug: string;
  teamName: string;
  /** false when the super admin is looking in. */
  ownTeam: boolean;
  onSignOut: () => void;
  onSignedOut: () => void;
}) {
  const toast = useToast();
  const [date, setDate] = useState(today);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [statsFor, setStatsFor] = useState<Member | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [building, setBuilding] = useState(false);
  const [dialog, setDialog] = useState<{ open: boolean; tab: LogTab; member: string | null }>({ open: false, tab: 'day', member: null });
  const day = useDay(date, slug);
  const t = today();
  const [held, setHeld] = useState<HeldOrder | null>(null);

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

  const act = useCallback(
    async (action: () => Promise<unknown>, success: string) => {
      try {
        await action();
        toast(success);
      } catch (e) {
        toast(errorText(e, 'Action failed.'), 'error');
        if (isSignedOut(e)) onSignedOut();
      }
    },
    [toast, onSignedOut],
  );

  return (
    <div className="flex min-h-screen w-full flex-col gap-6 px-5 pt-8 pb-16 sm:px-8 sm:pt-10">
      <header className="flex flex-col gap-3 border-b border-line pb-4 lg:flex-row lg:flex-nowrap lg:items-center lg:justify-between lg:gap-5">
        <div className="flex min-w-0 items-center gap-x-3 overflow-hidden lg:flex-1">
          <span className="hidden shrink-0 text-[11px] leading-none font-semibold tracking-[0.14em] whitespace-nowrap text-ink-3 uppercase 2xl:inline">
            <span className="text-ink">Ratings</span>
            <span className="mx-2 text-line-strong">/</span>
            {teamName}
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
            onClick={async () => {
              setBuilding(true);
              try {
                await downloadDayReport(date, day.groups, { label: teamName, file: slug });
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
          <Button className="shrink-0" onClick={onSignOut}>
            Sign out
          </Button>
          <Button variant="primary" className="shrink-0" onClick={() => setDialog({ open: true, tab: 'day', member: null })} disabled={day.roster.length === 0}>
            <PlusIcon className="size-3.5" />
            Add task
          </Button>
          <Button className="shrink-0" onClick={() => window.open(links.board(slug), '_blank', 'noopener')} title="Opens the team board in a new tab">
            Board
          </Button>
        </div>
      </header>

      {day.error && <div className="rounded-md border border-bad/25 bg-bad-bg px-4 py-3 text-[12.5px] font-medium text-bad">{day.error}</div>}

      {!day.loading && !day.error && day.roster.length === 0 && (
        <div className="rounded-md border border-line-strong bg-surface px-4 py-3">
          <p className="text-[12.5px] leading-[1.5] text-ink-2">
            No one is on your team yet. The super admin adds people at{' '}
            <code className="rounded-xs bg-mute-bg px-1 py-0.5 font-mono text-[11.5px]">/admin</code>.
          </p>
        </div>
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
          team={slug}
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
      <ReviewModal open={reviewOpen} onClose={() => setReviewOpen(false)} members={day.roster} identity={null} team={slug} title={`Review — ${teamName}`} />

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-[11.5px] text-ink-4">
        <p>{ownTeam ? `${teamName} — full edit access for any day` : `Viewing ${teamName}’s team as super admin`}</p>
        <p className="tnum">all times {APP.timezone.replace('_', ' ')}</p>
      </footer>
    </div>
  );
}
