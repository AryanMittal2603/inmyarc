import { put } from '@vercel/blob';
import type { Db } from './db.js';
import { env } from './env.js';
import { HttpError } from './http.js';
import { isDate } from './time.js';
import { ATTENDANCE, CATEGORIES, LIMITS, STATUSES, isUuid } from './validate.js';

/**
 * One-off import from the old Supabase project using its public anon key.
 * scope 'team' copies only the members; 'all' also copies attendance, entries, verdicts and
 * any attachments. Safe to run again: every row is upserted by its original id.
 */

const PAGE = 1000;
const CHUNK = 250;

type Row = Record<string, unknown>;

export interface ImportResult {
  members: number;
  dayLogs: number;
  entries: number;
  marks: number;
  files: { copied: number; failed: number; skipped: number };
}

function plain(message: string): string {
  try {
    const parsed = JSON.parse(message) as { message?: string; hint?: string };
    return [parsed.message, parsed.hint].filter(Boolean).join(' ');
  } catch {
    return message.slice(0, 200);
  }
}

function chunks<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const ts = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);

export type ImportScope = 'team' | 'all';

export async function importFromSupabase(
  d: Db,
  sourceUrl: string,
  key: string,
  scope: ImportScope = 'team',
  managerId: string | null = null,
): Promise<ImportResult> {
  const base = sourceUrl.trim().replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base)) {
    throw new HttpError(400, 'Use the old Supabase project URL, like https://abcd1234.supabase.co.');
  }
  const headers = { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' };

  async function fetchAll(table: string, select: string, order: string): Promise<Row[]> {
    const rows: Row[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const res = await fetch(
        `${base}/rest/v1/${table}?select=${encodeURIComponent(select)}&order=${order}&limit=${PAGE}&offset=${offset}`,
        { headers },
      );
      if (!res.ok) {
        throw new HttpError(502, `The old project refused to share ${table} (${res.status}). ${plain(await res.text())}`.trim());
      }
      const page = (await res.json()) as Row[];
      rows.push(...page);
      if (page.length < PAGE) return rows;
    }
  }

  const withHistory = scope === 'all';
  const none = async (): Promise<Row[]> => [];
  const [members, dayLogs, entries, marks] = await Promise.all([
    fetchAll('members', 'id,name,title,active,created_at', 'name.asc'),
    withHistory ? fetchAll('day_logs', 'id,member_id,log_date,attendance,note,created_at,updated_at', 'log_date.asc,id.asc') : none(),
    withHistory
      ? fetchAll(
          'entries',
          'id,log_date,member_id,created_by,title,details,status,minutes,remarks,attachment_path,attachment_name,attachment_type,attachment_size,status_by,status_at,created_at,updated_at',
          'created_at.asc,id.asc',
        )
      : none(),
    withHistory ? fetchAll('day_marks', 'member_id,log_date,category,overtime,holiday,hero,marked_at', 'log_date.asc,member_id.asc') : none(),
  ]);

  const memberIds = new Set(members.map((m) => m.id).filter(isUuid));
  const ref = (v: unknown) => (isUuid(v) && memberIds.has(v) ? v : null);

  const cleanMembers = members
    .filter((m) => isUuid(m.id) && typeof m.name === 'string' && m.name.trim())
    .map((m) => ({ id: m.id, name: (m.name as string).trim(), title: str(m.title), active: m.active !== false, created_at: ts(m.created_at) }));

  const cleanDayLogs = dayLogs
    .filter((l) => ref(l.member_id) && isDate(l.log_date) && ATTENDANCE.includes(l.attendance as never))
    .map((l) => ({
      id: isUuid(l.id) ? l.id : null,
      member_id: l.member_id,
      log_date: l.log_date,
      attendance: l.attendance,
      note: str(l.note),
      created_at: ts(l.created_at),
      updated_at: ts(l.updated_at),
    }));

  const cleanEntries = entries
    .filter((e) => isUuid(e.id) && ref(e.member_id) && isDate(e.log_date) && typeof e.title === 'string' && e.title.trim())
    .map((e) => {
      const minutes = typeof e.minutes === 'number' ? Math.min(Math.max(Math.round(e.minutes), 0), LIMITS.minutes) : null;
      return {
        id: e.id,
        log_date: e.log_date,
        member_id: e.member_id,
        created_by: ref(e.created_by),
        title: (e.title as string).trim(),
        details: str(e.details),
        status: STATUSES.includes(e.status as never) ? e.status : 'not_done',
        minutes,
        remarks: str(e.remarks),
        attachment_path: str(e.attachment_path),
        attachment_name: str(e.attachment_name),
        attachment_type: str(e.attachment_type),
        attachment_size: typeof e.attachment_size === 'number' ? Math.round(e.attachment_size) : null,
        status_by: ref(e.status_by),
        status_at: ts(e.status_at),
        created_at: ts(e.created_at),
        updated_at: ts(e.updated_at),
      };
    });

  const cleanMarks = marks
    .filter((m) => ref(m.member_id) && isDate(m.log_date) && CATEGORIES.includes(m.category as never))
    .map((m) => ({
      member_id: m.member_id,
      log_date: m.log_date,
      category: m.category,
      overtime: m.overtime === true,
      holiday: m.holiday === true,
      hero: m.hero === true,
      marked_at: ts(m.marked_at),
    }));

  for (const part of chunks(cleanMembers)) {
    await d.query(
      `insert into members (id, name, title, active, manager_id, created_at, updated_at)
       select x.id, x.name, x.title, x.active, $2::uuid, coalesce(x.created_at, now()), now()
       from jsonb_to_recordset($1::jsonb) as x(id uuid, name text, title text, active boolean, created_at timestamptz)
       on conflict (id) do update
         set name = excluded.name, title = excluded.title, active = excluded.active,
             manager_id = coalesce($2::uuid, members.manager_id), updated_at = now()`,
      [JSON.stringify(part), managerId],
    );
  }

  for (const part of chunks(cleanDayLogs)) {
    await d.query(
      `insert into day_logs (id, member_id, log_date, attendance, note, created_at, updated_at)
       select coalesce(x.id, gen_random_uuid()), x.member_id, x.log_date, x.attendance, x.note,
              coalesce(x.created_at, now()), coalesce(x.updated_at, now())
       from jsonb_to_recordset($1::jsonb) as x(id uuid, member_id uuid, log_date date, attendance text, note text,
            created_at timestamptz, updated_at timestamptz)
       on conflict (member_id, log_date) do update
         set attendance = excluded.attendance, note = excluded.note, updated_at = excluded.updated_at`,
      [JSON.stringify(part)],
    );
  }

  for (const part of chunks(cleanEntries)) {
    await d.query(
      `insert into entries (id, log_date, member_id, created_by, title, details, status, minutes, remarks,
                            attachment_path, attachment_name, attachment_type, attachment_size,
                            status_by, status_at, created_at, updated_at)
       select x.id, x.log_date, x.member_id, x.created_by, x.title, x.details, x.status, x.minutes, x.remarks,
              x.attachment_path, x.attachment_name, x.attachment_type, x.attachment_size,
              x.status_by, x.status_at, coalesce(x.created_at, now()), coalesce(x.updated_at, now())
       from jsonb_to_recordset($1::jsonb) as x(id uuid, log_date date, member_id uuid, created_by uuid, title text,
            details text, status text, minutes int, remarks text, attachment_path text, attachment_name text,
            attachment_type text, attachment_size int, status_by uuid, status_at timestamptz,
            created_at timestamptz, updated_at timestamptz)
       on conflict (id) do update set
         log_date = excluded.log_date, member_id = excluded.member_id, created_by = excluded.created_by,
         title = excluded.title, details = excluded.details, status = excluded.status, minutes = excluded.minutes,
         remarks = excluded.remarks,
         attachment_path = case
           when entries.attachment_path = 'task-files/' || excluded.attachment_path then entries.attachment_path
           else excluded.attachment_path end,
         attachment_name = excluded.attachment_name, attachment_type = excluded.attachment_type,
         attachment_size = excluded.attachment_size, status_by = excluded.status_by, status_at = excluded.status_at,
         created_at = excluded.created_at, updated_at = excluded.updated_at`,
      [JSON.stringify(part)],
    );
  }

  for (const part of chunks(cleanMarks)) {
    await d.query(
      `insert into day_marks (member_id, log_date, category, overtime, holiday, hero, marked_at)
       select x.member_id, x.log_date, x.category, x.overtime, x.holiday, x.hero, coalesce(x.marked_at, now())
       from jsonb_to_recordset($1::jsonb) as x(member_id uuid, log_date date, category text, overtime boolean,
            holiday boolean, hero boolean, marked_at timestamptz)
       on conflict (member_id, log_date) do update set
         category = excluded.category, overtime = excluded.overtime, holiday = excluded.holiday,
         hero = excluded.hero, marked_at = excluded.marked_at`,
      [JSON.stringify(part)],
    );
  }

  // Attachments: copy anything still pointing at the old storage bucket into the private Blob store.
  const files = { copied: 0, failed: 0, skipped: 0 };
  const pending = withHistory
    ? await d.query<{ id: string; attachment_path: string; attachment_type: string | null }>(
        `select id, attachment_path, attachment_type from entries
         where attachment_path is not null and attachment_path not like 'task-files/%'`,
      )
    : [];
  for (const e of pending) {
    if (!env.blobConfigured()) {
      files.skipped += 1;
      continue;
    }
    try {
      const objectPath = e.attachment_path.split('/').map(encodeURIComponent).join('/');
      const sign = await fetch(`${base}/storage/v1/object/sign/task-files/${objectPath}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: 600 }),
      });
      if (!sign.ok) throw new Error(`sign ${sign.status}`);
      const { signedURL } = (await sign.json()) as { signedURL?: string };
      if (!signedURL) throw new Error('no signed url');
      const file = await fetch(`${base}/storage/v1${signedURL}`);
      if (!file.ok) throw new Error(`download ${file.status}`);
      const body = Buffer.from(await file.arrayBuffer());
      const pathname = `task-files/${e.attachment_path}`;
      await put(pathname, body, {
        access: 'private',
        contentType: e.attachment_type || 'application/octet-stream',
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      await d.query(`update entries set attachment_path = $2 where id = $1`, [e.id, pathname]);
      files.copied += 1;
    } catch {
      files.failed += 1;
    }
  }

  return {
    members: cleanMembers.length,
    dayLogs: cleanDayLogs.length,
    entries: cleanEntries.length,
    marks: cleanMarks.length,
    files,
  };
}
