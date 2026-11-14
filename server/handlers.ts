import { createHash } from 'node:crypto';
import { get } from '@vercel/blob';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import {
  adminCookie,
  checkPasscode,
  clearCookie,
  hashPassword,
  managerCookie,
  passcodeConfigured,
  sessionsOf,
  verifyPassword,
  type Sessions,
} from './auth.js';
import { db, hasDatabase, type Db } from './db.js';
import { env } from './env.js';
import { HttpError, json, readJson } from './http.js';
import { importFromSupabase } from './importer.js';
import { isDate, today } from './time.js';
import {
  ATTACHMENT_PATH,
  ATTENDANCE,
  CATEGORIES,
  LIMITS,
  STATUSES,
  attachment,
  bool,
  date,
  isSlug,
  isUuid,
  minutes,
  oneOf,
  optionalUuid,
  password,
  personName,
  remarks,
  slug,
  text,
  title,
  uuid,
  type AttachmentInput,
} from './validate.js';

export interface Ctx {
  request: Request;
  url: URL;
  params: Record<string, string>;
}

const MEMBER_COLS = `id, name, title, active, manager_id`;
const TEAM_COLS = `id, name, slug, active`;
const DAY_LOG_COLS = `id, member_id, log_date::text as log_date, attendance, note, updated_at`;
const MARK_COLS = `member_id, log_date::text as log_date, category, overtime, holiday, hero, marked_at`;
const ENTRY_COLS = `id, log_date::text as log_date, member_id, created_by, title, details, status, minutes, remarks,
  attachment_path, attachment_name, attachment_type, attachment_size, status_by, status_at, created_at, updated_at`;

/** Rows whose member is on team $2 (or every row when $2 is null). */
const IN_TEAM = `($2::uuid is null or member_id in (select id from members where manager_id = $2))`;

const LOCKED = 'This day is locked. Your manager can change it from their page.';
const GONE = 'Nothing changed. The entry may have been removed by someone else, or this day is locked and needs your manager.';
const NO_TEAM = 'This team link isn’t active. Check the address or ask your manager.';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Team {
  id: string;
  name: string;
  slug: string;
  active: boolean;
}

interface MemberRef {
  id: string;
  manager_id: string | null;
}

/* ───────────────────────── editable window ───────────────────────── */

/**
 * Earliest day a team can log or edit from its board. A `settings` row wins over the
 * EDITABLE_FROM env var; with neither, only today is open.
 */
export function openFromValue(stored: string | null | undefined): string {
  const t = today();
  const raw = (stored ?? '').trim() || env.editableFrom();
  return isDate(raw) && raw <= t ? raw : t;
}

async function loadOpenFrom(d: Db): Promise<string> {
  const [row] = await d.query<{ value: string | null }>(`select value from settings where key = 'editable_from'`);
  return openFromValue(row?.value);
}

/* ───────────────────────── who may do what ───────────────────────── */

async function teamBySlug(d: Db, value: unknown): Promise<Team | null> {
  if (!isSlug(value)) return null;
  const [team] = await d.query<Team>(`select ${TEAM_COLS} from managers where slug = $1`, [value]);
  return team ?? null;
}

async function loadMember(d: Db, id: string): Promise<MemberRef> {
  const [m] = await d.query<MemberRef>(`select id, manager_id from members where id = $1`, [id]);
  if (!m) throw new HttpError(404, 'That person no longer exists. Refresh and try again.');
  return m;
}

/**
 * Writes about a member on a day:
 *  - super admin: any day up to today
 *  - that member's manager: any day up to today
 *  - anyone on the team's board (?team=<slug>): only for that team, inside the editable window
 */
async function authorizeWrite(ctx: Ctx, d: Db, member: MemberRef, day: string, teamParam: unknown): Promise<Sessions> {
  if (day > today()) throw new HttpError(400, 'That day has not happened yet.');
  const sessions = await sessionsOf(ctx.request, d);
  if (sessions.admin) return sessions;
  if (sessions.manager && member.manager_id === sessions.manager.managerId) return sessions;
  const team = await teamBySlug(d, teamParam);
  if (!team || !team.active || team.id !== member.manager_id) {
    throw new HttpError(403, 'That person isn’t on this team.', 'wrong_team');
  }
  if (day < (await loadOpenFrom(d))) throw new HttpError(403, LOCKED, 'locked');
  return sessions;
}

function requireAdmin(sessions: Sessions): void {
  if (!passcodeConfigured()) {
    throw new HttpError(503, 'The admin password is not set up yet. Add ADMIN_PASSCODE to the Vercel project and redeploy.', 'no_passcode');
  }
  if (!sessions.admin) throw new HttpError(401, 'Sign in at /admin first.', 'not_admin');
}

/** The team a read is about: ?team=<slug> (anyone) or ?team=* (super admin only, every team). */
async function readScope(ctx: Ctx, d: Db): Promise<{ team: Team | null }> {
  const raw = ctx.url.searchParams.get('team') ?? '';
  if (raw === '*') {
    requireAdmin(await sessionsOf(ctx.request, d));
    return { team: null };
  }
  const team = await teamBySlug(d, raw);
  if (!team || !team.active) throw new HttpError(404, NO_TEAM, 'no_team');
  return { team };
}

function teamParam(ctx: Ctx, body?: Record<string, unknown>): unknown {
  return ctx.url.searchParams.get('team') ?? body?.team;
}

function attachmentColumns(a: AttachmentInput | null | undefined) {
  return {
    attachment_path: a?.path ?? null,
    attachment_name: a?.name ?? null,
    attachment_type: a?.type ?? null,
    attachment_size: a?.size ?? null,
  };
}

/* ───────────────────────── public reads ───────────────────────── */

/** Active teams for the home page, with how many people have logged today. */
export async function getTeams(): Promise<Response> {
  const d = await db();
  const t = today();
  const teams = await d.query(
    `select t.name, t.slug,
            (select count(*)::int from members m where m.manager_id = t.id and m.active) as members,
            (select count(*)::int from members m where m.manager_id = t.id and m.active and (
                exists (select 1 from day_logs l where l.member_id = m.id and l.log_date = $1)
                or exists (select 1 from entries e where e.member_id = m.id and e.log_date = $1))) as reported
     from managers t where t.active order by lower(t.name)`,
    [t],
  );
  return json({ teams, today: t });
}

const SIGNATURE_SQL = `select
  (select count(*)::int from entries where log_date = $1 and ${IN_TEAM}) as e_n,
  (select max(updated_at)::text from entries where log_date = $1 and ${IN_TEAM}) as e_t,
  (select count(*)::int from day_logs where log_date = $1 and ${IN_TEAM}) as d_n,
  (select max(updated_at)::text from day_logs where log_date = $1 and ${IN_TEAM}) as d_t,
  (select count(*)::int from day_marks where log_date = $1 and ${IN_TEAM}) as m_n,
  (select max(marked_at)::text from day_marks where log_date = $1 and ${IN_TEAM}) as m_t,
  (select count(*)::int from members where $2::uuid is null or manager_id = $2) as p_n,
  (select max(updated_at)::text from members) as p_t,
  (select max(updated_at)::text from managers) as t_t,
  (select value from settings where key = 'editable_from') as editable_from`;

/** One day of one team's board (or every team for the super admin). ?sig= answers `unchanged` when nothing moved. */
export async function getDay(ctx: Ctx): Promise<Response> {
  const day = date(ctx.url.searchParams.get('date'));
  const d = await db();
  const { team } = await readScope(ctx, d);
  const teamId = team?.id ?? null;
  const [s] = await d.query<Record<string, unknown> & { editable_from: string | null }>(SIGNATURE_SQL, [day, teamId]);
  const t = today();
  const openFrom = openFromValue(s?.editable_from);
  const sig = createHash('sha1').update(JSON.stringify([s, openFrom, t, teamId])).digest('hex').slice(0, 20);
  if (ctx.url.searchParams.get('sig') === sig) return json({ unchanged: true, sig });

  const [members, dayLogs, entries, marks, teams] = await Promise.all([
    d.query(`select ${MEMBER_COLS} from members where $1::uuid is null or manager_id = $1 order by name asc`, [teamId]),
    d.query(`select ${DAY_LOG_COLS} from day_logs where log_date = $1 and ${IN_TEAM}`, [day, teamId]),
    d.query(`select ${ENTRY_COLS} from entries where log_date = $1 and ${IN_TEAM} order by created_at asc, id asc`, [day, teamId]),
    d.query(`select ${MARK_COLS} from day_marks where log_date = $1 and ${IN_TEAM}`, [day, teamId]),
    teamId ? Promise.resolve([]) : d.query(`select ${TEAM_COLS} from managers order by lower(name)`),
  ]);
  return json({
    sig,
    today: t,
    openFrom,
    team: team ? { id: team.id, name: team.name, slug: team.slug } : null,
    teams,
    members,
    dayLogs,
    entries,
    marks,
  });
}

/** Entries and verdicts from a start day to today, for Review and member stats. Scoped like /day. */
export async function getHistory(ctx: Ctx): Promise<Response> {
  const from = date(ctx.url.searchParams.get('from'), 'The start day');
  const t = today();
  const d = await db();
  const { team } = await readScope(ctx, d);
  const teamId = team?.id ?? null;
  const inTeam = `($3::uuid is null or member_id in (select id from members where manager_id = $3))`;
  const [members, entries, marks] = await Promise.all([
    d.query(`select ${MEMBER_COLS} from members where $1::uuid is null or manager_id = $1 order by name asc`, [teamId]),
    d.query(
      `select ${ENTRY_COLS} from entries where log_date between $1 and $2 and ${inTeam} order by log_date asc, created_at asc, id asc`,
      [from, t, teamId],
    ),
    d.query(`select ${MARK_COLS} from day_marks where log_date between $1 and $2 and ${inTeam}`, [from, t, teamId]),
  ]);
  return json({ members, entries, marks, today: t });
}

/** What is and isn't configured yet. Never throws, so the UI can explain setup. */
export async function getSetup(): Promise<Response> {
  const status = {
    database: hasDatabase(),
    ready: false,
    admin: passcodeConfigured(),
    files: env.blobConfigured(),
    managers: 0,
    members: 0,
    entries: 0,
    today: today(),
    openFrom: today(),
    error: null as string | null,
  };
  if (status.database) {
    try {
      const d = await db();
      const [row] = await d.query<{ managers: number; members: number; entries: number; editable_from: string | null }>(
        `select (select count(*)::int from managers) as managers,
                (select count(*)::int from members) as members,
                (select count(*)::int from entries) as entries,
                (select value from settings where key = 'editable_from') as editable_from`,
      );
      status.ready = true;
      status.managers = row?.managers ?? 0;
      status.members = row?.members ?? 0;
      status.entries = row?.entries ?? 0;
      status.openFrom = openFromValue(row?.editable_from);
    } catch (error) {
      status.error = `The database could not be reached. ${error instanceof Error ? error.message : ''}`.trim();
    }
  }
  return json(status);
}

/* ───────────────────────── sign-in ───────────────────────── */

export async function getSession(ctx: Ctx): Promise<Response> {
  const base = { adminConfigured: passcodeConfigured(), admin: false, manager: null as null | { name: string; slug: string }, team: null as null | { name: string; slug: string } };
  if (!hasDatabase()) return json(base);
  const d = await db();
  const sessions = await sessionsOf(ctx.request, d);
  const team = await teamBySlug(d, ctx.url.searchParams.get('team'));
  return json({
    ...base,
    admin: sessions.admin,
    manager: sessions.manager ? { name: sessions.manager.name, slug: sessions.manager.slug } : null,
    team: team && team.active ? { name: team.name, slug: team.slug } : null,
  });
}

export async function loginAdmin(ctx: Ctx): Promise<Response> {
  const body = await readJson<{ password?: unknown }>(ctx.request);
  if (!passcodeConfigured()) {
    throw new HttpError(503, 'The admin password is not set up yet. Add ADMIN_PASSCODE to the Vercel project and redeploy.', 'no_passcode');
  }
  if (typeof body.password !== 'string' || !checkPasscode(body.password)) {
    await delay(450);
    throw new HttpError(401, 'Incorrect password.', 'bad_password');
  }
  const d = await db();
  return json({ ok: true }, 200, { 'Set-Cookie': await adminCookie(ctx.request, d) });
}

export async function loginManager(ctx: Ctx): Promise<Response> {
  const body = await readJson<{ team?: unknown; password?: unknown }>(ctx.request);
  const d = await db();
  const [m] = isSlug(body.team)
    ? await d.query<{ id: string; name: string; slug: string; password_hash: string; session_version: number; active: boolean }>(
        `select id, name, slug, password_hash, session_version, active from managers where slug = $1`,
        [body.team],
      )
    : [];
  if (!m || !m.active) throw new HttpError(404, NO_TEAM, 'no_team');
  if (typeof body.password !== 'string' || !(await verifyPassword(body.password, m.password_hash))) {
    await delay(450);
    throw new HttpError(401, 'Incorrect password.', 'bad_password');
  }
  return json({ ok: true, manager: { name: m.name, slug: m.slug } }, 200, { 'Set-Cookie': await managerCookie(ctx.request, d, m) });
}

export async function logout(ctx: Ctx): Promise<Response> {
  const body = await readJson<{ scope?: unknown }>(ctx.request);
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(ctx.request, body.scope === 'admin' ? 'admin' : 'manager') });
}

/* ───────────────────────── team writes ───────────────────────── */

interface SubmitBody {
  memberId?: unknown;
  date?: unknown;
  attendance?: unknown;
  note?: unknown;
  entries?: unknown;
  team?: unknown;
}

/** "Log your day": attendance + note for the day, plus any number of entries, in one statement. */
export async function submitDay(ctx: Ctx): Promise<Response> {
  const body = await readJson<SubmitBody>(ctx.request);
  const memberId = uuid(body.memberId, 'Choose your name first.');
  const day = date(body.date);
  const attendance = oneOf(body.attendance, ATTENDANCE, 'Attendance');
  const note = text(body.note, LIMITS.note, 'The day note');
  const raw = Array.isArray(body.entries) ? (body.entries as Record<string, unknown>[]) : [];
  if (raw.length > 60) throw new HttpError(400, 'That is too many entries at once.');

  const items = raw
    .filter((e) => e && typeof e.title === 'string' && e.title.trim().length > 0)
    .map((e, ord) => ({
      ord,
      title: title(e.title),
      details: text(e.details, LIMITS.details, 'A detail'),
      status: oneOf(e.status ?? 'done', STATUSES, 'Status'),
      minutes: minutes(e.minutes),
      ...attachmentColumns(attachment(e.attachment)),
    }));
  if (items.length === 0 && attendance !== 'week_off' && attendance !== 'leave') {
    throw new HttpError(400, 'Add at least one entry, or mark the day as off.');
  }

  const d = await db();
  const member = await loadMember(d, memberId);
  await authorizeWrite(ctx, d, member, day, teamParam(ctx, body as Record<string, unknown>));

  const [row] = await d.query<{ count: number }>(
    `with day as (
       insert into day_logs (member_id, log_date, attendance, note)
       values ($1, $2, $3, $4)
       on conflict (member_id, log_date)
       do update set attendance = excluded.attendance, note = excluded.note, updated_at = now()
       returning id
     ), ins as (
       insert into entries (log_date, member_id, created_by, title, details, status, minutes,
                            attachment_path, attachment_name, attachment_type, attachment_size, created_at, updated_at)
       select $2::date, $1::uuid, $1::uuid, x.title, x.details, x.status, x.minutes,
              x.attachment_path, x.attachment_name, x.attachment_type, x.attachment_size,
              now() + x.ord * interval '1 millisecond', now()
       from jsonb_to_recordset($5::jsonb) as x(ord int, title text, details text, status text, minutes int,
            attachment_path text, attachment_name text, attachment_type text, attachment_size int)
       returning id
     )
     select (select count(*)::int from ins) as count, (select count(*)::int from day) as days`,
    [memberId, day, attendance, note, JSON.stringify(items)],
  );
  return json({ count: row?.count ?? 0 });
}

interface EntryBody {
  memberId?: unknown;
  date?: unknown;
  title?: unknown;
  details?: unknown;
  status?: unknown;
  minutes?: unknown;
  assigned?: unknown;
  attachment?: unknown;
  team?: unknown;
}

/** One entry: "Assign a task" (created_by = null, starts as Not done) or a single logged task. */
export async function createEntry(ctx: Ctx): Promise<Response> {
  const body = await readJson<EntryBody>(ctx.request);
  const assigned = bool(body.assigned);
  const memberId = uuid(body.memberId, assigned ? 'Choose who the task is for.' : 'Choose your name first.');
  const day = date(body.date);
  const taskTitle = title(body.title, assigned ? 'Describe the task.' : 'A task needs a title.');
  const details = text(body.details, assigned ? LIMITS.brief : LIMITS.details, assigned ? 'The brief' : 'The detail');
  const status = body.status === undefined ? (assigned ? 'not_done' : 'done') : oneOf(body.status, STATUSES, 'Status');
  const mins = minutes(body.minutes);
  const files = attachmentColumns(attachment(body.attachment));

  const d = await db();
  const member = await loadMember(d, memberId);
  await authorizeWrite(ctx, d, member, day, teamParam(ctx, body as Record<string, unknown>));

  const [entry] = await d.query(
    `insert into entries (log_date, member_id, created_by, title, details, status, minutes,
                          attachment_path, attachment_name, attachment_type, attachment_size)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     returning ${ENTRY_COLS}`,
    [day, memberId, assigned ? null : memberId, taskTitle, details, status, mins, files.attachment_path, files.attachment_name, files.attachment_type, files.attachment_size],
  );
  return json({ entry }, 201);
}

async function loadEntryOwner(d: Db, id: string): Promise<{ log_date: string; member: MemberRef }> {
  const [row] = await d.query<{ log_date: string; member_id: string; manager_id: string | null }>(
    `select e.log_date::text as log_date, m.id as member_id, m.manager_id
     from entries e join members m on m.id = e.member_id where e.id = $1`,
    [id],
  );
  if (!row) throw new HttpError(404, GONE);
  return { log_date: row.log_date, member: { id: row.member_id, manager_id: row.manager_id } };
}

/** Edit an entry. Only the fields present in the body change. */
export async function updateEntry(ctx: Ctx): Promise<Response> {
  const id = uuid(ctx.params.id, 'That entry could not be found.');
  const body = await readJson<Record<string, unknown>>(ctx.request);
  const d = await db();
  const owner = await loadEntryOwner(d, id);
  await authorizeWrite(ctx, d, owner.member, owner.log_date, teamParam(ctx, body));

  const sets: string[] = [];
  const values: unknown[] = [id];
  const set = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  if ('title' in body) set('title', title(body.title));
  if ('details' in body) set('details', text(body.details, LIMITS.brief, 'The detail'));
  if ('status' in body) set('status', oneOf(body.status, STATUSES, 'Status'));
  if ('minutes' in body) set('minutes', minutes(body.minutes));
  if ('remarks' in body) set('remarks', remarks(body.remarks));
  if ('attachment' in body) {
    const a = attachment(body.attachment);
    if (a !== undefined) for (const [column, value] of Object.entries(attachmentColumns(a))) set(column, value);
  }
  if (body.statusChanged === true) {
    values.push(optionalUuid(body.actorId));
    sets.push(`status_by = (select id from members where id = $${values.length}::uuid)`, `status_at = now()`);
  }
  if (sets.length === 0) throw new HttpError(400, 'Nothing to change.');
  sets.push('updated_at = now()');

  const [entry] = await d.query(`update entries set ${sets.join(', ')} where id = $1 returning ${ENTRY_COLS}`, values);
  if (!entry) throw new HttpError(404, GONE);
  return json({ entry });
}

export async function deleteEntry(ctx: Ctx): Promise<Response> {
  const id = uuid(ctx.params.id, 'That entry could not be found.');
  const d = await db();
  const owner = await loadEntryOwner(d, id);
  await authorizeWrite(ctx, d, owner.member, owner.log_date, teamParam(ctx));
  await d.query(`delete from entries where id = $1`, [id]);
  return json({ ok: true });
}

/** Attendance for one person and day. Leaves the day note alone. */
export async function setAttendance(ctx: Ctx): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(ctx.request);
  const memberId = uuid(body.memberId, 'Choose a teammate first.');
  const day = date(body.date);
  const attendance = oneOf(body.attendance, ATTENDANCE, 'Attendance');
  const d = await db();
  const member = await loadMember(d, memberId);
  await authorizeWrite(ctx, d, member, day, teamParam(ctx, body));
  const [dayLog] = await d.query(
    `insert into day_logs (member_id, log_date, attendance) values ($1, $2, $3)
     on conflict (member_id, log_date) do update set attendance = excluded.attendance, updated_at = now()
     returning ${DAY_LOG_COLS}`,
    [memberId, day, attendance],
  );
  return json({ dayLog });
}

/** A verdict on a whole day, plus brownies: the member's manager or the super admin. category = null clears it. */
export async function setMark(ctx: Ctx): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(ctx.request);
  const memberId = uuid(body.memberId, 'Choose a teammate first.');
  const day = date(body.date);
  if (day > today()) throw new HttpError(400, 'That day has not happened yet.');
  const d = await db();
  const member = await loadMember(d, memberId);
  const sessions = await sessionsOf(ctx.request, d);
  const byManager = sessions.manager && sessions.manager.managerId === member.manager_id;
  if (!sessions.admin && !byManager) {
    throw new HttpError(sessions.manager ? 403 : 401, 'Only this person’s manager can give verdicts.', 'not_manager');
  }
  const markedBy = sessions.admin ? 'admin' : `manager:${sessions.manager!.slug}`;

  if (body.category === null || body.category === undefined || body.category === '') {
    await d.query(`delete from day_marks where member_id = $1 and log_date = $2`, [memberId, day]);
    return json({ mark: null });
  }
  const category = oneOf(body.category, CATEGORIES, 'The verdict');
  const [mark] = await d.query(
    `insert into day_marks (member_id, log_date, category, overtime, holiday, hero, marked_by)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (member_id, log_date) do update
       set category = excluded.category, overtime = excluded.overtime, holiday = excluded.holiday,
           hero = excluded.hero, marked_by = excluded.marked_by, marked_at = now()
     returning ${MARK_COLS}`,
    [memberId, day, category, bool(body.overtime), bool(body.holiday), bool(body.hero), markedBy],
  );
  return json({ mark });
}

/* ───────────────────────── super admin ───────────────────────── */

async function adminDb(ctx: Ctx): Promise<Db> {
  const d = await db();
  requireAdmin(await sessionsOf(ctx.request, d));
  return d;
}

const MANAGER_OUT = `t.id, t.name, t.slug, t.active, t.created_at,
  (select count(*)::int from members m where m.manager_id = t.id and m.active) as members`;

/** Everything the dashboard's people pages need. */
export async function adminOverview(ctx: Ctx): Promise<Response> {
  const d = await adminDb(ctx);
  const [managers, members, setting] = await Promise.all([
    d.query(`select ${MANAGER_OUT} from managers t order by lower(t.name)`),
    d.query(
      `select m.id, m.name, m.title, m.active, m.manager_id, m.created_at,
              exists (select 1 from entries e where e.member_id = m.id)
                or exists (select 1 from day_logs l where l.member_id = m.id)
                or exists (select 1 from day_marks k where k.member_id = m.id) as has_history
       from members m order by lower(m.name)`,
    ),
    d.query<{ value: string | null }>(`select value from settings where key = 'editable_from'`),
  ]);
  return json({
    managers,
    members,
    settings: { editableFrom: setting[0]?.value ?? null, envEditableFrom: env.editableFrom() || null, openFrom: openFromValue(setting[0]?.value) },
    status: { files: env.blobConfigured(), admin: passcodeConfigured() },
    today: today(),
  });
}

async function assertSlugFree(d: Db, value: string, exceptId: string | null): Promise<void> {
  const [taken] = await d.query(`select 1 from managers where slug = $1 and ($2::uuid is null or id <> $2)`, [value, exceptId]);
  if (taken) throw new HttpError(409, `The link name "${value}" is already used by another manager.`);
}

export async function createManager(ctx: Ctx): Promise<Response> {
  const d = await adminDb(ctx);
  const body = await readJson<Record<string, unknown>>(ctx.request);
  const name = personName(body.name, 'The manager’s name');
  const s = slug(body.slug);
  const pw = password(body.password);
  await assertSlugFree(d, s, null);
  const [manager] = await d.query(
    `with ins as (insert into managers (name, slug, password_hash) values ($1, $2, $3) returning *)
     select ${MANAGER_OUT} from ins t`,
    [name, s, await hashPassword(pw)],
  );
  return json({ manager }, 201);
}

export async function updateManager(ctx: Ctx): Promise<Response> {
  const d = await adminDb(ctx);
  const id = uuid(ctx.params.id, 'That manager could not be found.');
  const body = await readJson<Record<string, unknown>>(ctx.request);
  const sets: string[] = [];
  const values: unknown[] = [id];
  const set = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  let signOut = false;
  if ('name' in body) set('name', personName(body.name, 'The manager’s name'));
  if ('slug' in body) {
    const s = slug(body.slug);
    await assertSlugFree(d, s, id);
    set('slug', s);
  }
  if ('password' in body) {
    set('password_hash', await hashPassword(password(body.password)));
    signOut = true;
  }
  if ('active' in body) {
    set('active', bool(body.active));
    if (!bool(body.active)) signOut = true;
  }
  if (sets.length === 0) throw new HttpError(400, 'Nothing to change.');
  if (signOut) sets.push('session_version = session_version + 1');
  sets.push('updated_at = now()');
  const [manager] = await d.query(
    `with up as (update managers set ${sets.join(', ')} where id = $1 returning *) select ${MANAGER_OUT} from up t`,
    values,
  );
  if (!manager) throw new HttpError(404, 'That manager could not be found.');
  return json({ manager });
}

/** Removes a manager. Their employees stay, unassigned, with all their history. */
export async function deleteManager(ctx: Ctx): Promise<Response> {
  const d = await adminDb(ctx);
  const id = uuid(ctx.params.id, 'That manager could not be found.');
  await d.query(`update members set manager_id = null, updated_at = now() where manager_id = $1`, [id]);
  const [gone] = await d.query(`delete from managers where id = $1 returning id`, [id]);
  if (!gone) throw new HttpError(404, 'That manager could not be found.');
  return json({ ok: true });
}

async function assertManagerId(d: Db, value: unknown): Promise<string | null> {
  if (value === null || value === undefined || value === '') return null;
  if (!isUuid(value)) throw new HttpError(400, 'Pick a manager from the list.');
  const [m] = await d.query(`select id from managers where id = $1`, [value]);
  if (!m) throw new HttpError(404, 'That manager could not be found.');
  return value.toLowerCase();
}

async function assertNameFree(d: Db, name: string, managerId: string | null, exceptId: string | null): Promise<void> {
  const [clash] = await d.query(
    `select 1 from members where active and lower(name) = lower($1) and manager_id is not distinct from $2::uuid
       and ($3::uuid is null or id <> $3)`,
    [name, managerId, exceptId],
  );
  if (clash) throw new HttpError(409, `Someone called ${name} is already on that team.`);
}

export async function createMember(ctx: Ctx): Promise<Response> {
  const d = await adminDb(ctx);
  const body = await readJson<Record<string, unknown>>(ctx.request);
  const name = personName(body.name, 'The employee’s name');
  const managerId = await assertManagerId(d, body.managerId);
  await assertNameFree(d, name, managerId, null);
  const [member] = await d.query(
    `insert into members (name, manager_id) values ($1, $2) returning ${MEMBER_COLS}, created_at, false as has_history`,
    [name, managerId],
  );
  return json({ member }, 201);
}

export async function updateMember(ctx: Ctx): Promise<Response> {
  const d = await adminDb(ctx);
  const id = uuid(ctx.params.id, 'That employee could not be found.');
  const body = await readJson<Record<string, unknown>>(ctx.request);
  const [current] = await d.query<{ name: string; manager_id: string | null }>(`select name, manager_id from members where id = $1`, [id]);
  if (!current) throw new HttpError(404, 'That employee could not be found.');
  const sets: string[] = [];
  const values: unknown[] = [id];
  const set = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  const name = 'name' in body ? personName(body.name, 'The employee’s name') : current.name;
  const managerId = 'managerId' in body ? await assertManagerId(d, body.managerId) : current.manager_id;
  if ('name' in body || 'managerId' in body) await assertNameFree(d, name, managerId, id);
  if ('name' in body) set('name', name);
  if ('managerId' in body) set('manager_id', managerId);
  if ('active' in body) set('active', bool(body.active));
  if (sets.length === 0) throw new HttpError(400, 'Nothing to change.');
  sets.push('updated_at = now()');
  const [member] = await d.query(`update members set ${sets.join(', ')} where id = $1 returning ${MEMBER_COLS}`, values);
  return json({ member });
}

/** Only people with no history can be deleted; everyone else is deactivated instead. */
export async function deleteMember(ctx: Ctx): Promise<Response> {
  const d = await adminDb(ctx);
  const id = uuid(ctx.params.id, 'That employee could not be found.');
  const [row] = await d.query<{ has_history: boolean }>(
    `select exists (select 1 from entries where member_id = $1)
         or exists (select 1 from day_logs where member_id = $1)
         or exists (select 1 from day_marks where member_id = $1) as has_history
     from members where id = $1`,
    [id],
  );
  if (!row) throw new HttpError(404, 'That employee could not be found.');
  if (row.has_history) throw new HttpError(409, 'They have logged days. Deactivate them instead, so the history stays.');
  await d.query(`delete from members where id = $1`, [id]);
  return json({ ok: true });
}

/** The backfill window for team boards: a start day, or null for today only. */
export async function updateSettings(ctx: Ctx): Promise<Response> {
  const d = await adminDb(ctx);
  const body = await readJson<{ editableFrom?: unknown }>(ctx.request);
  if (body.editableFrom === null || body.editableFrom === '') {
    await d.query(`delete from settings where key = 'editable_from'`);
  } else {
    const from = date(body.editableFrom, 'The start day');
    if (from > today()) throw new HttpError(400, 'Pick today or an earlier day.');
    await d.query(
      `insert into settings (key, value) values ('editable_from', $1)
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [from],
    );
  }
  const [row] = await d.query<{ value: string | null }>(`select value from settings where key = 'editable_from'`);
  return json({ editableFrom: row?.value ?? null, openFrom: openFromValue(row?.value) });
}

export async function runImport(ctx: Ctx): Promise<Response> {
  const d = await adminDb(ctx);
  const body = await readJson<{ sourceUrl?: unknown; sourceKey?: unknown; scope?: unknown; managerId?: unknown }>(ctx.request);
  if (typeof body.sourceUrl !== 'string' || typeof body.sourceKey !== 'string' || !body.sourceKey.trim()) {
    throw new HttpError(400, 'Paste the old project URL and its anon key.');
  }
  const managerId = await assertManagerId(d, body.managerId);
  const scope = body.scope === 'all' ? 'all' : 'team';
  return json(await importFromSupabase(d, body.sourceUrl, body.sourceKey.trim(), scope, managerId));
}

/* ───────────────────────── files (Vercel Blob, private) ───────────────────────── */

/** Issues short-lived tokens so the browser uploads straight to Blob (up to 10 MB). */
export async function uploadToken(ctx: Ctx): Promise<Response> {
  if (!env.blobConfigured()) {
    throw new HttpError(503, 'File storage is not connected yet. Add a private Blob store to the Vercel project and redeploy.', 'no_blob');
  }
  const body = await readJson<HandleUploadBody>(ctx.request);
  const result = await handleUpload({
    body,
    request: ctx.request,
    onBeforeGenerateToken: async (pathname) => {
      if (!ATTACHMENT_PATH.test(pathname)) throw new Error('That file name is not allowed.');
      return { maximumSizeInBytes: LIMITS.fileBytes, addRandomSuffix: false, allowOverwrite: false };
    },
  });
  return json(result);
}

/** Streams a private attachment through the API. */
export async function getFile(ctx: Ctx): Promise<Response> {
  const id = uuid(ctx.url.searchParams.get('entry'), 'That entry could not be found.');
  const d = await db();
  const [row] = await d.query<{ attachment_path: string | null; attachment_name: string | null; attachment_type: string | null }>(
    `select attachment_path, attachment_name, attachment_type from entries where id = $1`,
    [id],
  );
  const notFound = () =>
    new Response('This attachment could not be found.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  if (!row?.attachment_path) return notFound();

  const result = await get(row.attachment_path, {
    access: 'private',
    ifNoneMatch: ctx.request.headers.get('if-none-match') ?? undefined,
  }).catch(() => null);
  if (!result) return notFound();
  if (result.statusCode === 304) {
    return new Response(null, { status: 304, headers: { ETag: result.blob.etag, 'Cache-Control': 'private, no-cache' } });
  }
  const name = row.attachment_name || row.attachment_path.split('/').pop() || 'attachment';
  return new Response(result.stream, {
    headers: {
      'Content-Type': row.attachment_type || result.blob.contentType || 'application/octet-stream',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
      'X-Content-Type-Options': 'nosniff',
      ETag: result.blob.etag,
      'Cache-Control': 'private, no-cache',
    },
  });
}
