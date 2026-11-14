import { createHash } from 'node:crypto';
import { get } from '@vercel/blob';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { checkPasscode, isAdmin, passcodeConfigured, requireAdmin } from './auth.js';
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
  minutes,
  oneOf,
  optionalUuid,
  remarks,
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

const MEMBER_COLS = `id, name, title, active`;
const DAY_LOG_COLS = `id, member_id, log_date::text as log_date, attendance, note, updated_at`;
const MARK_COLS = `member_id, log_date::text as log_date, category, overtime, holiday, hero, marked_at`;
const ENTRY_COLS = `id, log_date::text as log_date, member_id, created_by, title, details, status, minutes, remarks,
  attachment_path, attachment_name, attachment_type, attachment_size, status_by, status_at, created_at, updated_at`;

const LOCKED = 'This day is locked. Unlock it with the passcode.';
const GONE = 'Nothing changed. The entry may have been removed by someone else, or this day is locked and needs the admin page.';

/* ───────────────────────── editable window ───────────────────────── */

/**
 * Earliest day the team may log or edit without the passcode. A `settings` row wins over
 * the EDITABLE_FROM env var; with neither, only today is open.
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

async function assertWritable(request: Request, d: Db, day: string): Promise<void> {
  if (day > today()) throw new HttpError(400, 'That day has not happened yet.');
  if (isAdmin(request)) return;
  if (day < (await loadOpenFrom(d))) throw new HttpError(403, LOCKED, 'locked');
}

async function assertMember(d: Db, id: string): Promise<void> {
  const [row] = await d.query<{ id: string }>(`select id from members where id = $1`, [id]);
  if (!row) throw new HttpError(404, 'That teammate no longer exists. Refresh and try again.');
}

function attachmentColumns(a: AttachmentInput | null | undefined) {
  return {
    attachment_path: a?.path ?? null,
    attachment_name: a?.name ?? null,
    attachment_type: a?.type ?? null,
    attachment_size: a?.size ?? null,
  };
}

/* ───────────────────────── reads ───────────────────────── */

const SIGNATURE_SQL = `select
  (select count(*)::int from entries where log_date = $1) as e_n,
  (select max(updated_at)::text from entries where log_date = $1) as e_t,
  (select count(*)::int from day_logs where log_date = $1) as d_n,
  (select max(updated_at)::text from day_logs where log_date = $1) as d_t,
  (select count(*)::int from day_marks where log_date = $1) as m_n,
  (select max(marked_at)::text from day_marks where log_date = $1) as m_t,
  (select count(*)::int from members) as p_n,
  (select max(updated_at)::text from members) as p_t,
  (select value from settings where key = 'editable_from') as editable_from`;

/** One day of the board. With ?sig= it answers `unchanged` when nothing moved (cheap polling). */
export async function getDay({ url }: Ctx): Promise<Response> {
  const day = date(url.searchParams.get('date'));
  const d = await db();
  const [s] = await d.query<Record<string, unknown> & { editable_from: string | null }>(SIGNATURE_SQL, [day]);
  const t = today();
  const openFrom = openFromValue(s?.editable_from);
  const sig = createHash('sha1').update(JSON.stringify([s, openFrom, t])).digest('hex').slice(0, 20);
  if (url.searchParams.get('sig') === sig) return json({ unchanged: true, sig });

  const [members, dayLogs, entries, marks] = await Promise.all([
    d.query(`select ${MEMBER_COLS} from members order by name asc`),
    d.query(`select ${DAY_LOG_COLS} from day_logs where log_date = $1`, [day]),
    d.query(`select ${ENTRY_COLS} from entries where log_date = $1 order by created_at asc, id asc`, [day]),
    d.query(`select ${MARK_COLS} from day_marks where log_date = $1`, [day]),
  ]);
  return json({ sig, today: t, openFrom, members, dayLogs, entries, marks });
}

/** Everything from a start day to today, for the Review and member stats views. */
export async function getHistory({ url }: Ctx): Promise<Response> {
  const from = date(url.searchParams.get('from'), 'The start day');
  const t = today();
  const d = await db();
  const [members, entries, marks] = await Promise.all([
    d.query(`select ${MEMBER_COLS} from members order by name asc`),
    d.query(
      `select ${ENTRY_COLS} from entries where log_date between $1 and $2 order by log_date asc, created_at asc, id asc`,
      [from, t],
    ),
    d.query(`select ${MARK_COLS} from day_marks where log_date between $1 and $2`, [from, t]),
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
    members: 0,
    entries: 0,
    today: today(),
    openFrom: today(),
    error: null as string | null,
  };
  if (status.database) {
    try {
      const d = await db();
      const [row] = await d.query<{ members: number; entries: number; editable_from: string | null }>(
        `select (select count(*)::int from members) as members,
                (select count(*)::int from entries) as entries,
                (select value from settings where key = 'editable_from') as editable_from`,
      );
      status.ready = true;
      status.members = row?.members ?? 0;
      status.entries = row?.entries ?? 0;
      status.openFrom = openFromValue(row?.editable_from);
    } catch (error) {
      status.error = `The database could not be reached. ${error instanceof Error ? error.message : ''}`.trim();
    }
  }
  return json(status);
}

/* ───────────────────────── writes ───────────────────────── */

interface SubmitBody {
  memberId?: unknown;
  date?: unknown;
  attendance?: unknown;
  note?: unknown;
  entries?: unknown;
}

/** "Log your day": attendance + note for the day, plus any number of entries, in one statement. */
export async function submitDay({ request }: Ctx): Promise<Response> {
  const body = await readJson<SubmitBody>(request);
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
  await assertMember(d, memberId);
  await assertWritable(request, d, day);

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
}

/** One entry: "Assign a task" (created_by = null, starts as Not done) or a single logged task. */
export async function createEntry({ request }: Ctx): Promise<Response> {
  const body = await readJson<EntryBody>(request);
  const assigned = bool(body.assigned);
  const memberId = uuid(body.memberId, assigned ? 'Choose who the task is for.' : 'Choose your name first.');
  const day = date(body.date);
  const taskTitle = title(body.title, assigned ? 'Describe the task.' : 'A task needs a title.');
  const details = text(body.details, assigned ? LIMITS.brief : LIMITS.details, assigned ? 'The brief' : 'The detail');
  const status = body.status === undefined ? (assigned ? 'not_done' : 'done') : oneOf(body.status, STATUSES, 'Status');
  const mins = minutes(body.minutes);
  const files = attachmentColumns(attachment(body.attachment));

  const d = await db();
  await assertMember(d, memberId);
  await assertWritable(request, d, day);

  const [entry] = await d.query(
    `insert into entries (log_date, member_id, created_by, title, details, status, minutes,
                          attachment_path, attachment_name, attachment_type, attachment_size)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     returning ${ENTRY_COLS}`,
    [
      day,
      memberId,
      assigned ? null : memberId,
      taskTitle,
      details,
      status,
      mins,
      files.attachment_path,
      files.attachment_name,
      files.attachment_type,
      files.attachment_size,
    ],
  );
  return json({ entry }, 201);
}

/** Edit an entry. Only the fields present in the body change. */
export async function updateEntry({ request, params }: Ctx): Promise<Response> {
  const id = uuid(params.id, 'That entry could not be found.');
  const body = await readJson<Record<string, unknown>>(request);
  const d = await db();
  const [current] = await d.query<{ log_date: string }>(`select log_date::text as log_date from entries where id = $1`, [id]);
  if (!current) throw new HttpError(404, GONE);
  await assertWritable(request, d, current.log_date);

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
    if (a !== undefined) {
      const cols = attachmentColumns(a);
      for (const [column, value] of Object.entries(cols)) set(column, value);
    }
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

export async function deleteEntry({ request, params }: Ctx): Promise<Response> {
  const id = uuid(params.id, 'That entry could not be found.');
  const d = await db();
  const [current] = await d.query<{ log_date: string }>(`select log_date::text as log_date from entries where id = $1`, [id]);
  if (!current) throw new HttpError(404, GONE);
  await assertWritable(request, d, current.log_date);
  await d.query(`delete from entries where id = $1`, [id]);
  return json({ ok: true });
}

/** Attendance for one person and day. Leaves the day note alone. */
export async function setAttendance({ request }: Ctx): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);
  const memberId = uuid(body.memberId, 'Choose a teammate first.');
  const day = date(body.date);
  const attendance = oneOf(body.attendance, ATTENDANCE, 'Attendance');
  const d = await db();
  await assertMember(d, memberId);
  await assertWritable(request, d, day);
  const [dayLog] = await d.query(
    `insert into day_logs (member_id, log_date, attendance) values ($1, $2, $3)
     on conflict (member_id, log_date) do update set attendance = excluded.attendance, updated_at = now()
     returning ${DAY_LOG_COLS}`,
    [memberId, day, attendance],
  );
  return json({ dayLog });
}

/** The admin's verdict on a whole day, plus brownies. category = null clears it. */
export async function setMark({ request }: Ctx): Promise<Response> {
  requireAdmin(request, 'Only the admin can give verdicts. Unlock /rating with the passcode.');
  const body = await readJson<Record<string, unknown>>(request);
  const memberId = uuid(body.memberId, 'Choose a teammate first.');
  const day = date(body.date);
  if (day > today()) throw new HttpError(400, 'That day has not happened yet.');
  const d = await db();
  await assertMember(d, memberId);

  if (body.category === null || body.category === undefined || body.category === '') {
    await d.query(`delete from day_marks where member_id = $1 and log_date = $2`, [memberId, day]);
    return json({ mark: null });
  }
  const category = oneOf(body.category, CATEGORIES, 'The verdict');
  const [mark] = await d.query(
    `insert into day_marks (member_id, log_date, category, overtime, holiday, hero)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (member_id, log_date) do update
       set category = excluded.category, overtime = excluded.overtime, holiday = excluded.holiday,
           hero = excluded.hero, marked_at = now()
     returning ${MARK_COLS}`,
    [memberId, day, category, bool(body.overtime), bool(body.holiday), bool(body.hero)],
  );
  return json({ mark });
}

/* ───────────────────────── admin ───────────────────────── */

export async function verifyPasscode({ request }: Ctx): Promise<Response> {
  const body = await readJson<{ passcode?: unknown }>(request);
  if (!passcodeConfigured()) {
    throw new HttpError(503, 'The admin passcode is not set up yet. Add ADMIN_PASSCODE to the Vercel project and redeploy.', 'no_passcode');
  }
  if (typeof body.passcode !== 'string' || !checkPasscode(body.passcode)) {
    await new Promise((resolve) => setTimeout(resolve, 450));
    throw new HttpError(401, 'Incorrect passcode.', 'bad_passcode');
  }
  return json({ ok: true });
}

export async function runImport({ request }: Ctx): Promise<Response> {
  requireAdmin(request);
  const body = await readJson<{ sourceUrl?: unknown; sourceKey?: unknown; scope?: unknown }>(request);
  if (typeof body.sourceUrl !== 'string' || typeof body.sourceKey !== 'string' || !body.sourceKey.trim()) {
    throw new HttpError(400, 'Paste the old project URL and its anon key.');
  }
  const d = await db();
  const scope = body.scope === 'all' ? 'all' : 'team';
  const result = await importFromSupabase(d, body.sourceUrl, body.sourceKey.trim(), scope);
  return json(result);
}

/* ───────────────────────── files (Vercel Blob, private) ───────────────────────── */

/** Issues short-lived tokens so the browser uploads straight to Blob (up to 10 MB). */
export async function uploadToken({ request }: Ctx): Promise<Response> {
  if (!env.blobConfigured()) {
    throw new HttpError(503, 'File storage is not connected yet. Add a private Blob store to the Vercel project and redeploy.', 'no_blob');
  }
  const body = await readJson<HandleUploadBody>(request);
  const result = await handleUpload({
    body,
    request,
    onBeforeGenerateToken: async (pathname) => {
      if (!ATTACHMENT_PATH.test(pathname)) throw new Error('That file name is not allowed.');
      return { maximumSizeInBytes: LIMITS.fileBytes, addRandomSuffix: false, allowOverwrite: false };
    },
  });
  return json(result);
}

/** Streams a private attachment through the API. */
export async function getFile({ request, url }: Ctx): Promise<Response> {
  const id = uuid(url.searchParams.get('entry'), 'That entry could not be found.');
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
    ifNoneMatch: request.headers.get('if-none-match') ?? undefined,
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
