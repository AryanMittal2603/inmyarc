import { useEffect, useMemo, useRef, useState } from 'react';
import { ATTENDANCE, STATUSES, longDate, shortDate, today } from '../lib/config';
import { fileProblem, formatBytes } from '../lib/files';
import type { Attendance, DayLog, Member } from '../lib/types';
import type { DraftEntry } from '../hooks/useDay';
import { useToast } from '../context/toast';
import { CloseIcon, PaperclipIcon, PlusIcon } from './icons';
import { Button, FieldLabel, Input, Modal, Segmented, Select, Textarea, TimeInput, cx } from './ui';

export type LogTab = 'day' | 'assign';

const blankEntry = (): DraftEntry => ({ title: '', details: '', status: 'done', hours: '', mins: '', file: null });

function AttachButton({ file, onPick, onProblem }: { file: File | null; onPick: (file: File | null) => void; onProblem: (message: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <input
        ref={input}
        type="file"
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0] ?? null;
          e.target.value = '';
          if (!picked) return;
          const problem = fileProblem(picked);
          onProblem(problem);
          if (!problem) onPick(picked);
        }}
      />
      {file ? (
        <>
          <span title={file.name} className="inline-flex min-w-0 items-center gap-1 rounded-xs bg-mute-bg px-1.5 py-1 text-[11px] font-medium text-ink-2">
            <PaperclipIcon className="size-3 shrink-0" />
            <span className="max-w-[160px] truncate">{file.name}</span>
            <span className="tnum shrink-0 text-ink-4">{formatBytes(file.size)}</span>
          </span>
          <button
            type="button"
            aria-label="Remove attachment"
            onClick={() => {
              onProblem(null);
              onPick(null);
            }}
            className="focus-ring shrink-0 rounded-xs p-1 text-ink-4 transition hover:bg-off-bg hover:text-off"
          >
            <CloseIcon className="size-3" />
          </button>
        </>
      ) : (
        <Button size="sm" onClick={() => input.current?.click()}>
          <PaperclipIcon className="size-3" />
          Attach file
        </Button>
      )}
    </div>
  );
}

export interface LogDayModalProps {
  open: boolean;
  onClose: () => void;
  members: Member[];
  dayLogs: DayLog[];
  date: string;
  onDateChange?: (date: string) => void;
  identity: string | null;
  onIdentity: (memberId: string) => void;
  initialTab: LogTab;
  initialMember: string | null;
  /** Earliest day the form may log (the team's backfill window). Admin: undefined = any past day. */
  minDate?: string;
  onSubmitDay: (input: { memberId: string; attendance: Attendance; note: string; entries: DraftEntry[] }) => Promise<number>;
  onAssign: (input: { memberId: string; logDate: string; title: string; details: string }) => Promise<unknown>;
}

/** "Log your day" with a second tab, "Assign to someone". */
export function LogDayModal({
  open,
  onClose,
  members,
  dayLogs,
  date,
  onDateChange,
  identity,
  onIdentity,
  initialTab,
  initialMember,
  minDate,
  onSubmitDay,
  onAssign,
}: LogDayModalProps) {
  const toast = useToast();
  const [tab, setTab] = useState<LogTab>(initialTab);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [who, setWho] = useState('');
  const [attendance, setAttendance] = useState<Attendance>('full_day');
  const [note, setNote] = useState('');
  const [entries, setEntries] = useState<DraftEntry[]>([blankEntry()]);
  const [assignee, setAssignee] = useState('');
  const [task, setTask] = useState('');
  const [brief, setBrief] = useState('');
  const [assignDate, setAssignDate] = useState(date);

  const saved = useMemo(() => dayLogs.find((l) => l.member_id === who && l.log_date === date) ?? null, [dayLogs, who, date]);
  const dateRef = useRef(date);
  dateRef.current = date;

  // Reset every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    const me = identity ?? '';
    setTab(initialTab);
    setError(null);
    setEntries([blankEntry()]);
    setTask('');
    setBrief('');
    setAssignDate(dateRef.current);
    if (initialTab === 'assign') {
      setAssignee(initialMember ?? '');
      setWho(me);
    } else {
      setWho(initialMember ?? me);
      setAssignee('');
    }
  }, [open, initialTab, initialMember, identity]);

  const t = today();
  const isValidDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && value <= t && (!minDate || value >= minDate);
  const canPickDay = !!onDateChange && (!minDate || minDate < t);
  const dayHint = minDate ? (minDate >= t ? 'today only' : `from ${shortDate(minDate)}`) : undefined;

  // Prefill attendance and note from what is already saved for this person and day.
  const prefillKey = `${date}:${who}:${saved ? 'saved' : 'new'}`;
  const lastPrefill = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      lastPrefill.current = null;
      return;
    }
    if (lastPrefill.current !== prefillKey) {
      lastPrefill.current = prefillKey;
      setAttendance(saved?.attendance ?? 'full_day');
      setNote(saved?.note ?? '');
    }
  }, [open, prefillKey, saved]);

  const titled = entries.filter((e) => e.title.trim().length > 0);
  const offDay = attendance === 'week_off' || attendance === 'leave';
  const patch = (index: number, change: Partial<DraftEntry>) => setEntries((list) => list.map((e, i) => (i === index ? { ...e, ...change } : e)));

  async function saveDay() {
    setError(null);
    if (!who) return setError('Choose your name first.');
    if (!titled.length && !offDay) return setError('Add at least one entry, or mark the day as off.');
    setBusy(true);
    try {
      onIdentity(who);
      const count = await onSubmitDay({ memberId: who, attendance, note, entries });
      toast(count > 0 ? `${count} ${count === 1 ? 'entry' : 'entries'} added for ${longDate(date)}.` : 'Day updated.');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function assign() {
    setError(null);
    if (!assignee) return setError('Choose who the task is for.');
    if (!task.trim()) return setError('Describe the task.');
    setBusy(true);
    try {
      await onAssign({ memberId: assignee, logDate: assignDate, title: task, details: brief });
      const name = members.find((m) => m.id === assignee)?.name ?? 'the team';
      toast(`Task assigned to ${name}.`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not assign. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const primaryLabel = busy
    ? 'Saving…'
    : tab === 'day'
      ? titled.length
        ? `Save ${titled.length} ${titled.length === 1 ? 'entry' : 'entries'}`
        : 'Save day'
      : 'Assign task';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tab === 'day' ? 'Log your day' : 'Assign a task'}
      subtitle={longDate(tab === 'assign' ? assignDate : date)}
      width={tab === 'day' ? 680 : 560}
      footer={
        <>
          {error && <p className="mr-auto text-[12px] font-medium text-off">{error}</p>}
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={tab === 'day' ? saveDay : assign} disabled={busy}>
            {primaryLabel}
          </Button>
        </>
      }
    >
      <div className="mb-5 flex gap-1 border-b border-line" data-stagger>
        {(
          [
            ['day', 'My day'],
            ['assign', 'Assign to someone'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setTab(key);
              setError(null);
            }}
            className={cx(
              'focus-ring -mb-px border-b-2 px-3 pb-2.5 text-[12.5px] font-medium transition-colors',
              tab === key ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:text-ink-2',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'day' ? (
        <div className="flex flex-col gap-5">
          <div className={cx('grid gap-4', canPickDay ? 'sm:grid-cols-[1fr_150px_1fr]' : 'sm:grid-cols-2')} data-stagger>
            <div>
              <FieldLabel htmlFor="who">Your name</FieldLabel>
              <Select id="who" value={who} onChange={(e) => setWho(e.target.value)}>
                <option value="">Select your name…</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </div>
            {canPickDay && onDateChange && (
              <div>
                <FieldLabel htmlFor="day" hint={dayHint}>
                  Day
                </FieldLabel>
                <Input
                  id="day"
                  type="date"
                  value={date}
                  min={minDate}
                  max={t}
                  onChange={(e) => {
                    if (isValidDay(e.target.value)) onDateChange(e.target.value);
                  }}
                  className="tnum"
                />
              </div>
            )}
            <div>
              <FieldLabel htmlFor="note" hint="optional">
                Day note
              </FieldLabel>
              <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Context for the day" maxLength={140} />
            </div>
          </div>

          <div data-stagger>
            <FieldLabel>Attendance</FieldLabel>
            <Segmented value={attendance} onChange={setAttendance} options={ATTENDANCE.map((a) => ({ key: a.key, label: a.label }))} />
          </div>

          <div data-stagger>
            <FieldLabel hint={offDay ? 'optional on an off day' : 'one per task · a file each, up to 10 MB'}>What you worked on</FieldLabel>
            <div className="flex flex-col gap-2">
              {entries.map((entry, index) => (
                <div key={index} className="rounded-sm border border-line bg-paper p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="tnum w-5 shrink-0 text-[11px] font-semibold text-ink-4">{String(index + 1).padStart(2, '0')}</span>
                    <Input value={entry.title} onChange={(e) => patch(index, { title: e.target.value })} placeholder="Task or work done" maxLength={180} />
                    <button
                      type="button"
                      aria-label="Remove entry"
                      disabled={entries.length === 1}
                      onClick={() => setEntries((list) => list.filter((_, i) => i !== index))}
                      className="focus-ring shrink-0 rounded-xs p-1.5 text-ink-4 transition hover:bg-off-bg hover:text-off disabled:pointer-events-none disabled:opacity-30"
                    >
                      <CloseIcon className="size-3.5" />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-col gap-2 pl-7">
                    <Textarea rows={1} value={entry.details} onChange={(e) => patch(index, { details: e.target.value })} placeholder="Detail — optional" maxLength={400} />
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-medium text-ink-3">Time taken</span>
                        <TimeInput hours={entry.hours} mins={entry.mins} onChange={(v) => patch(index, v)} />
                      </div>
                      <Segmented value={entry.status} onChange={(status) => patch(index, { status })} options={STATUSES.map((s) => ({ key: s.key, label: s.label }))} />
                      <AttachButton file={entry.file} onPick={(file) => patch(index, { file })} onProblem={setError} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <Button size="sm" className="mt-2" onClick={() => setEntries((list) => [...list, blankEntry()])}>
              <PlusIcon className="size-3" />
              Add another entry
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div data-stagger>
            <FieldLabel htmlFor="to">Assign to</FieldLabel>
            <Select id="to" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Select a teammate…</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>
          <div data-stagger>
            <FieldLabel htmlFor="on" hint={dayHint}>
              For the day
            </FieldLabel>
            <Input
              id="on"
              type="date"
              value={assignDate}
              min={minDate}
              max={t}
              onChange={(e) => {
                if (isValidDay(e.target.value)) setAssignDate(e.target.value);
              }}
              className="tnum"
            />
          </div>
          <div data-stagger>
            <FieldLabel htmlFor="task">Task</FieldLabel>
            <Input id="task" value={task} onChange={(e) => setTask(e.target.value)} placeholder="What needs to be done" maxLength={180} />
          </div>
          <div data-stagger>
            <FieldLabel htmlFor="brief" hint="optional">
              Brief
            </FieldLabel>
            <Textarea id="brief" rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Any context, links or acceptance criteria" maxLength={600} />
          </div>
          <p className="text-[11.5px] leading-[1.5] text-ink-3" data-stagger>
            The task lands in their row for that day as <span className="font-medium text-ink-2">Not done</span>. Anyone can move it to Done or Rework
            required and leave a remark straight from the table; the manager rates it.
          </p>
        </div>
      )}
    </Modal>
  );
}
