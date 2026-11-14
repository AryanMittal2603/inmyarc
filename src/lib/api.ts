import type {
  AdminManager,
  AdminMember,
  AdminOverview,
  Attachment,
  Attendance,
  Category,
  DayPayload,
  Entry,
  HistoryPayload,
  ImportResult,
  Mark,
  Member,
  Session,
  SetupStatus,
  Status,
  TeamLink,
} from './types';

/**
 * Sign-ins live in HttpOnly cookies set by the API (super admin: 12 hours, managers: 7 days),
 * so nothing secret is kept in the page.
 */

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
  if (method !== 'GET') headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      cache: 'no-store',
      credentials: 'same-origin',
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

/**
 * Which team a request is about: a link name ("alpha"), or "*" for every team (super admin).
 * Writes carry the link name so team boards can only touch their own people.
 */
export type TeamScope = string;

const teamQuery = (team: TeamScope, joiner: '?' | '&' = '?') => (team && team !== '*' ? `${joiner}team=${encodeURIComponent(team)}` : '');

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
  setup: () => request<SetupStatus>('GET', 'setup'),
  teams: () => request<{ teams: TeamLink[]; today: string }>('GET', 'teams'),
  day: (date: string, team: TeamScope, sig?: string | null) =>
    request<DayPayload | { unchanged: true; sig: string }>(
      'GET',
      `day?date=${date}&team=${encodeURIComponent(team)}${sig ? `&sig=${sig}` : ''}`,
    ),
  history: (from: string, team: TeamScope) => request<HistoryPayload>('GET', `history?from=${from}&team=${encodeURIComponent(team)}`),

  // sign-in
  session: (team?: string) => request<Session>('GET', `auth/session${team ? `?team=${encodeURIComponent(team)}` : ''}`),
  signInAdmin: (password: string) => request<{ ok: true }>('POST', 'auth/admin', { password }),
  signInManager: (team: string, password: string) =>
    request<{ ok: true; manager: { name: string; slug: string } }>('POST', 'auth/manager', { team, password }),
  signOut: (scope: 'admin' | 'manager') => request<{ ok: true }>('POST', 'auth/logout', { scope }),

  // the day's work
  submitDay: (team: TeamScope, body: SubmitDayBody) => request<{ count: number }>('POST', `day/submit${teamQuery(team)}`, body),
  createEntry: (
    team: TeamScope,
    body: {
      memberId: string;
      date: string;
      title: string;
      details: string;
      status?: Status;
      minutes?: number | null;
      assigned: boolean;
      attachment?: Attachment | null;
    },
  ) => request<{ entry: Entry }>('POST', `entries${teamQuery(team)}`, body),
  updateEntry: (team: TeamScope, id: string, patch: EntryPatch) => request<{ entry: Entry }>('PATCH', `entries/${id}${teamQuery(team)}`, patch),
  deleteEntry: (team: TeamScope, id: string) => request<{ ok: true }>('DELETE', `entries/${id}${teamQuery(team)}`),
  setAttendance: (team: TeamScope, body: { memberId: string; date: string; attendance: Attendance }) =>
    request('PUT', `attendance${teamQuery(team)}`, body),
  setMark: (body: { memberId: string; date: string; category: Category | null; overtime: boolean; holiday: boolean; hero: boolean }) =>
    request<{ mark: Mark | null }>('PUT', 'marks', body),

  // super admin
  overview: () => request<AdminOverview>('GET', 'admin/overview'),
  createManager: (body: { name: string; slug: string; password: string }) => request<{ manager: AdminManager }>('POST', 'admin/managers', body),
  updateManager: (id: string, patch: { name?: string; slug?: string; password?: string; active?: boolean }) =>
    request<{ manager: AdminManager }>('PATCH', `admin/managers/${id}`, patch),
  deleteManager: (id: string) => request<{ ok: true }>('DELETE', `admin/managers/${id}`),
  createMember: (body: { name: string; managerId: string | null }) => request<{ member: AdminMember }>('POST', 'admin/members', body),
  updateMember: (id: string, patch: { name?: string; managerId?: string | null; active?: boolean }) =>
    request<{ member: Member }>('PATCH', `admin/members/${id}`, patch),
  deleteMember: (id: string) => request<{ ok: true }>('DELETE', `admin/members/${id}`),
  saveSettings: (editableFrom: string | null) => request<{ editableFrom: string | null; openFrom: string }>('PUT', 'admin/settings', { editableFrom }),
  importFromOldSite: (sourceUrl: string, sourceKey: string, scope: 'team' | 'all', managerId: string | null) =>
    request<ImportResult>('POST', 'admin/import', { sourceUrl, sourceKey, scope, managerId }),
};

export function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** The API refused because the sign-in is missing or has expired. */
export function isSignedOut(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}
