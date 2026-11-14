import type { Attachment, Attendance, Category, DayPayload, Entry, HistoryPayload, ImportResult, Mark, SetupStatus, Status } from './types';

/** Held in memory only (like the original): a reload locks /rating again. */
let adminPasscode: string | null = null;

export function setAdminPasscode(passcode: string | null): void {
  adminPasscode = passcode;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (adminPasscode) headers['x-admin-passcode'] = encodeURIComponent(adminPasscode);
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
  }
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    const err = (data ?? {}) as { error?: string; code?: string };
    throw new ApiError(err.error || `The server answered ${response.status}.`, response.status, err.code);
  }
  return data as T;
}

export interface SubmitDayBody {
  memberId: string;
  date: string;
  attendance: Attendance;
  note: string;
  entries: Array<{ title: string; details: string; status: Status; minutes: number | null; attachment: Attachment | null }>;
}

export interface EntryPatch {
  title?: string;
  details?: string;
  status?: Status;
  minutes?: number | null;
  remarks?: string;
  attachment?: Attachment | null;
  statusChanged?: boolean;
  actorId?: string | null;
}

export const api = {
  day: (date: string, sig?: string | null) =>
    request<DayPayload | { unchanged: true; sig: string }>('GET', `day?date=${date}${sig ? `&sig=${sig}` : ''}`),
  history: (from: string) => request<HistoryPayload>('GET', `history?from=${from}`),
  setup: () => request<SetupStatus>('GET', 'setup'),
  submitDay: (body: SubmitDayBody) => request<{ count: number }>('POST', 'day/submit', body),
  createEntry: (body: {
    memberId: string;
    date: string;
    title: string;
    details: string;
    status?: Status;
    minutes?: number | null;
    assigned: boolean;
    attachment?: Attachment | null;
  }) => request<{ entry: Entry }>('POST', 'entries', body),
  updateEntry: (id: string, patch: EntryPatch) => request<{ entry: Entry }>('PATCH', `entries/${id}`, patch),
  deleteEntry: (id: string) => request<{ ok: true }>('DELETE', `entries/${id}`),
  setAttendance: (body: { memberId: string; date: string; attendance: Attendance }) => request('PUT', 'attendance', body),
  setMark: (body: { memberId: string; date: string; category: Category | null; overtime: boolean; holiday: boolean; hero: boolean }) =>
    request<{ mark: Mark | null }>('PUT', 'marks', body),
  verify: (passcode: string) => request<{ ok: true }>('POST', 'admin/verify', { passcode }),
  importHistory: (sourceUrl: string, sourceKey: string) => request<ImportResult>('POST', 'admin/import', { sourceUrl, sourceKey }),
};

export function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
