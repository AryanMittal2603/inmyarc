import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api, errorText } from '../lib/api';
import { buildGroups } from '../lib/board';
import { NO_BROWNIES, today } from '../lib/config';
import { uploadAttachment } from '../lib/files';
import type { Attachment, Attendance, Brownies, Category, DayLog, Entry, Mark, Member, Status } from '../lib/types';
import { toMinutes } from '../components/ui';

/** How often an open board checks for changes made by others (only while the tab is visible). */
const POLL_MS = 10_000;

export interface DraftEntry {
  title: string;
  details: string;
  status: Status;
  hours: string;
  mins: string;
  file: File | null;
}

export interface EntryEdit {
  title: string;
  details: string;
  status: Status;
  minutes: number | null;
  remarks: string;
  statusChanged: boolean;
  actorId: string | null;
  /** File = replace, 'clear' = remove, null = keep */
  attachment: File | 'clear' | null;
}

interface DayState {
  members: Member[];
  dayLogs: DayLog[];
  entries: Entry[];
  marks: Mark[];
  openFrom: string | null;
  loading: boolean;
  error: string | null;
  /** The API has no database yet. */
  needsSetup: boolean;
}

const EMPTY: DayState = {
  members: [],
  dayLogs: [],
  entries: [],
  marks: [],
  openFrom: null,
  loading: true,
  error: null,
  needsSetup: false,
};

/** Editable by the team when the day is between the backfill start and today. */
export function isOpenDay(date: string, openFrom: string | null): boolean {
  const t = today();
  return date <= t && date >= (openFrom ?? t);
}

export function useDay(date: string) {
  const [state, setState] = useState<DayState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [syncedAt, setSyncedAt] = useState(() => new Date().toISOString());
  const dateRef = useRef(date);
  dateRef.current = date;
  const sigRef = useRef<string | null>(null);

  const load = useCallback(async (options: { quiet?: boolean } = {}) => {
    const day = dateRef.current;
    if (!options.quiet) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await api.day(day, options.quiet ? sigRef.current : null);
      if (dateRef.current !== day) return;
      if ('unchanged' in res) {
        setState((s) => ({ ...s, loading: false, error: null }));
      } else {
        sigRef.current = res.sig;
        setState({
          members: res.members,
          dayLogs: res.dayLogs,
          entries: res.entries,
          marks: res.marks,
          openFrom: res.openFrom,
          loading: false,
          error: null,
          needsSetup: false,
        });
      }
      setSyncedAt(new Date().toISOString());
    } catch (error) {
      if (dateRef.current !== day) return;
      const needsSetup = error instanceof ApiError && error.code === 'no_database';
      setState((s) => ({ ...s, loading: false, needsSetup, error: needsSetup ? null : errorText(error, 'Something went wrong.') }));
    }
  }, []);

  useEffect(() => {
    sigRef.current = null;
    void load();
  }, [date, load]);

  // "Live": poll while visible, and catch up whenever the tab regains focus.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void load({ quiet: true });
    };
    const timer = window.setInterval(refresh, POLL_MS);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);

  const roster = useMemo(() => state.members.filter((m) => m.active), [state.members]);
  const groups = useMemo(
    () => buildGroups(state.members, state.dayLogs, state.entries, state.marks, date),
    [state.members, state.dayLogs, state.entries, state.marks, date],
  );
  const memberById = useMemo(() => new Map(state.members.map((m) => [m.id, m])), [state.members]);
  const locked = !isOpenDay(date, state.openFrom);

  /** Run a write, then refresh quietly. */
  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      setBusy(true);
      try {
        const result = await action();
        await load({ quiet: true });
        return result;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const submitDay = useCallback(
    (input: { memberId: string; attendance: Attendance; note: string; entries: DraftEntry[] }) =>
      run(async () => {
        const titled = input.entries.filter((e) => e.title.trim().length > 0);
        const files = await Promise.all(titled.map((e) => (e.file ? uploadAttachment(e.file) : null)));
        const res = await api.submitDay({
          memberId: input.memberId,
          date: dateRef.current,
          attendance: input.attendance,
          note: input.note.trim(),
          entries: titled.map((e, i) => ({
            title: e.title.trim(),
            details: e.details.trim(),
            status: e.status,
            minutes: toMinutes(e.hours, e.mins),
            attachment: files[i],
          })),
        });
        return res.count;
      }),
    [run],
  );

  const assignTask = useCallback(
    (input: { memberId: string; logDate: string; title: string; details: string }) =>
      run(() =>
        api.createEntry({
          memberId: input.memberId,
          date: input.logDate,
          title: input.title.trim(),
          details: input.details.trim(),
          assigned: true,
        }),
      ),
    [run],
  );

  const setStatus = useCallback(
    (entryId: string, status: Status, actorId: string | null) =>
      run(() => api.updateEntry(entryId, { status, statusChanged: true, actorId })),
    [run],
  );

  const updateEntry = useCallback(
    (entryId: string, edit: EntryEdit) =>
      run(async () => {
        let attachment: Attachment | null | undefined;
        if (edit.attachment instanceof File) attachment = await uploadAttachment(edit.attachment);
        else if (edit.attachment === 'clear') attachment = null;
        return api.updateEntry(entryId, {
          title: edit.title.trim(),
          details: edit.details.trim(),
          status: edit.status,
          minutes: edit.minutes,
          remarks: edit.remarks,
          statusChanged: edit.statusChanged,
          actorId: edit.actorId,
          ...(attachment !== undefined ? { attachment } : {}),
        });
      }),
    [run],
  );

  const setMark = useCallback(
    (memberId: string, category: Category | null, flags: Brownies = NO_BROWNIES) =>
      run(() => api.setMark({ memberId, date: dateRef.current, category, ...flags })),
    [run],
  );

  const setRemarks = useCallback((entryId: string, remarks: string) => run(() => api.updateEntry(entryId, { remarks })), [run]);

  const deleteEntry = useCallback((entryId: string) => run(() => api.deleteEntry(entryId)), [run]);

  const setAttendance = useCallback(
    (memberId: string, attendance: Attendance) => run(() => api.setAttendance({ memberId, date: dateRef.current, attendance })),
    [run],
  );

  return {
    ...state,
    busy,
    locked,
    roster,
    groups,
    memberById,
    syncedAt,
    reload: load,
    submitDay,
    assignTask,
    setStatus,
    updateEntry,
    setMark,
    setRemarks,
    deleteEntry,
    setAttendance,
  };
}

export type DayData = ReturnType<typeof useDay>;
