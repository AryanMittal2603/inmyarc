import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { setDb } from '../server/db.js';
import { handle } from '../server/router.js';
import { addDays, today } from '../server/time.js';

const PASS = 'Test@123';
let pg: PGlite;

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await handle(
    new Request(`http://local/api/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const isJson = res.headers.get('content-type')?.includes('json');
  return { status: res.status, data: (isJson ? await res.json() : await res.text()) as any };
}
const admin = { 'x-admin-passcode': encodeURIComponent(PASS) };

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

before(async () => {
  pg = new PGlite();
  setDb({ query: async (text, params = []) => (await pg.query(text, params as never[])).rows as never });
  process.env.ADMIN_PASSCODE = PASS;
  delete process.env.EDITABLE_FROM;
});
after(async () => {
  await pg.close();
});

describe('setup', () => {
  test('creates the schema and reports an empty database', async () => {
    const r = await call('GET', 'setup');
    assert.equal(r.status, 200);
    assert.equal(r.data.database, true);
    assert.equal(r.data.ready, true);
    assert.equal(r.data.admin, true);
    assert.equal(r.data.members, 0);
    assert.equal(r.data.openFrom, today());
  });

  test('seeds members', async () => {
    await pg.query(
      `insert into members (id, name, active) values ($1, 'Amogh', true), ($2, 'Akshay', true), ($3, 'Zed', false)`,
      [A, B, C],
    );
    const r = await call('GET', `day?date=${today()}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.members.map((m: { name: string }) => m.name), ['Akshay', 'Amogh', 'Zed']);
    assert.equal(r.data.openFrom, today());
    assert.ok(r.data.sig);
  });
});

describe('logging a day (team)', () => {
  beforeEach(async () => {
    await pg.exec(`delete from entries; delete from day_logs; delete from day_marks; delete from settings where key = 'editable_from'`);
    delete process.env.EDITABLE_FROM;
  });

  test('saves attendance, note and entries in order', async () => {
    const r = await call('POST', 'day/submit', {
      memberId: A,
      date: today(),
      attendance: 'wfh',
      note: '  Exams day  ',
      entries: [
        { title: 'First', details: 'one', status: 'done', minutes: 90 },
        { title: '   ', details: 'ignored, no title' },
        { title: 'Second', status: 'rework', minutes: 5000 },
      ],
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.count, 2);
    const day = await call('GET', `day?date=${today()}`);
    assert.deepEqual(day.data.entries.map((e: { title: string }) => e.title), ['First', 'Second']);
    assert.equal(day.data.entries[0].created_by, A);
    assert.equal(day.data.entries[1].minutes, 1440, 'minutes are clamped to a day');
    assert.equal(day.data.dayLogs[0].attendance, 'wfh');
    assert.equal(day.data.dayLogs[0].note, 'Exams day');
  });

  test('needs an entry unless the day is off', async () => {
    const r = await call('POST', 'day/submit', { memberId: A, date: today(), attendance: 'full_day', entries: [] });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, 'Add at least one entry, or mark the day as off.');
    const off = await call('POST', 'day/submit', { memberId: A, date: today(), attendance: 'leave', entries: [] });
    assert.equal(off.status, 200);
    assert.equal(off.data.count, 0);
  });

  test('only today is open to the team by default; the admin can log any past day', async () => {
    const y = addDays(today(), -1);
    const body = { memberId: A, date: y, attendance: 'full_day', entries: [{ title: 'Late', status: 'done' }] };
    const locked = await call('POST', 'day/submit', body);
    assert.equal(locked.status, 403);
    assert.equal(locked.data.error, 'This day is locked. Unlock it with the passcode.');
    const ok = await call('POST', 'day/submit', body, admin);
    assert.equal(ok.status, 200);
    const wrong = await call('POST', 'day/submit', body, { 'x-admin-passcode': 'nope' });
    assert.equal(wrong.status, 403);
  });

  test('EDITABLE_FROM opens a backfill window; a settings row overrides it', async () => {
    const y = addDays(today(), -1);
    const body = { memberId: A, date: y, attendance: 'full_day', entries: [{ title: 'Backfill', status: 'done' }] };
    process.env.EDITABLE_FROM = addDays(today(), -5);
    assert.equal((await call('POST', 'day/submit', body)).status, 200);
    const day = await call('GET', `day?date=${y}`);
    assert.equal(day.data.openFrom, addDays(today(), -5));
    await pg.query(`insert into settings (key, value) values ('editable_from', $1)`, [today()]);
    assert.equal((await call('POST', 'day/submit', body)).status, 403);
  });

  test('future days are refused, even for the admin', async () => {
    const r = await call('POST', 'day/submit', { memberId: A, date: addDays(today(), 1), attendance: 'leave', entries: [] }, admin);
    assert.equal(r.status, 400);
  });

  test('validates fields', async () => {
    const long = 'x'.repeat(181);
    assert.equal((await call('POST', 'day/submit', { memberId: A, date: today(), attendance: 'full_day', entries: [{ title: long }] })).status, 400);
    assert.equal((await call('POST', 'day/submit', { memberId: A, date: today(), attendance: 'nope', entries: [] })).status, 400);
    assert.equal((await call('POST', 'day/submit', { memberId: 'x', date: today(), attendance: 'leave' })).status, 400);
    assert.equal((await call('POST', 'day/submit', { memberId: A, date: '2026-02-30', attendance: 'leave' })).status, 400);
    const badFile = await call('POST', 'day/submit', {
      memberId: A, date: today(), attendance: 'full_day',
      entries: [{ title: 'With file', attachment: { path: '../etc/passwd', name: 'x', size: 10 } }],
    });
    assert.equal(badFile.status, 400);
    const bigFile = await call('POST', 'day/submit', {
      memberId: A, date: today(), attendance: 'full_day',
      entries: [{ title: 'With file', attachment: { path: 'task-files/2026-11/0b7c9a2e-1111-4111-8111-111111111111.pdf', name: 'big.pdf', size: 11 * 1024 * 1024 } }],
    });
    assert.equal(bigFile.status, 400);
    assert.match(bigFile.data.error, /too big/);
    const goodFile = await call('POST', 'day/submit', {
      memberId: A, date: today(), attendance: 'full_day',
      entries: [{ title: 'With file', attachment: { path: 'task-files/2026-11/0b7c9a2e-1111-4111-8111-111111111111.pdf', name: 'report.pdf', type: 'application/pdf', size: 2048 } }],
    });
    assert.equal(goodFile.status, 200);
    const day = await call('GET', `day?date=${today()}`);
    assert.equal(day.data.entries[0].attachment_name, 'report.pdf');
    assert.equal(day.data.entries[0].attachment_size, 2048);
  });
});

describe('editing entries', () => {
  let id: string;
  beforeEach(async () => {
    await pg.exec(`delete from entries; delete from day_logs; delete from day_marks`);
    const r = await call('POST', 'entries', { memberId: B, date: today(), title: 'Write report', details: 'brief', assigned: true });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    id = r.data.entry.id;
  });

  test('assigned tasks start as Not done with no author', async () => {
    const day = await call('GET', `day?date=${today()}`);
    const e = day.data.entries[0];
    assert.equal(e.created_by, null);
    assert.equal(e.status, 'not_done');
    assert.equal(e.minutes, null);
  });

  test('status changes record who and when', async () => {
    const r = await call('PATCH', `entries/${id}`, { status: 'done', statusChanged: true, actorId: A });
    assert.equal(r.status, 200);
    assert.equal(r.data.entry.status, 'done');
    assert.equal(r.data.entry.status_by, A);
    assert.ok(r.data.entry.status_at);
    const stale = await call('PATCH', `entries/${id}`, { status: 'rework', statusChanged: true, actorId: '99999999-9999-4999-8999-999999999999' });
    assert.equal(stale.data.entry.status_by, null, 'unknown actors are dropped, not rejected');
  });

  test('remarks are trimmed and cut at 500', async () => {
    const r = await call('PATCH', `entries/${id}`, { remarks: `  ${'y'.repeat(600)}  ` });
    assert.equal(r.data.entry.remarks.length, 500);
    const cleared = await call('PATCH', `entries/${id}`, { remarks: '   ' });
    assert.equal(cleared.data.entry.remarks, null);
  });

  test('full edit, attachment removal, and title rules', async () => {
    const r = await call('PATCH', `entries/${id}`, { title: 'Report v2', details: '', minutes: 45, status: 'done', statusChanged: false });
    assert.equal(r.data.entry.title, 'Report v2');
    assert.equal(r.data.entry.details, null);
    assert.equal(r.data.entry.minutes, 45);
    assert.equal(r.data.entry.status_by, null);
    const empty = await call('PATCH', `entries/${id}`, { title: '  ' });
    assert.equal(empty.status, 400);
    assert.equal(empty.data.error, 'A task needs a title.');
    const cleared = await call('PATCH', `entries/${id}`, { attachment: null });
    assert.equal(cleared.data.entry.attachment_path, null);
  });

  test('past entries are locked for the team but not the admin', async () => {
    await pg.query(`update entries set log_date = $2 where id = $1`, [id, addDays(today(), -3)]);
    const locked = await call('PATCH', `entries/${id}`, { remarks: 'hi' });
    assert.equal(locked.status, 403);
    const del = await call('DELETE', `entries/${id}`);
    assert.equal(del.status, 403);
    const ok = await call('PATCH', `entries/${id}`, { remarks: 'hi' }, admin);
    assert.equal(ok.status, 200);
    assert.equal((await call('DELETE', `entries/${id}`, undefined, admin)).status, 200);
    const gone = await call('PATCH', `entries/${id}`, { remarks: 'again' }, admin);
    assert.equal(gone.status, 404);
  });

  test('assign needs a person and a task', async () => {
    const noOne = await call('POST', 'entries', { date: today(), title: 'x', assigned: true });
    assert.equal(noOne.data.error, 'Choose who the task is for.');
    const noTask = await call('POST', 'entries', { memberId: B, date: today(), title: ' ', assigned: true });
    assert.equal(noTask.data.error, 'Describe the task.');
  });
});

describe('attendance and verdicts', () => {
  beforeEach(async () => {
    await pg.exec(`delete from entries; delete from day_logs; delete from day_marks`);
  });

  test('attendance upserts and keeps the note', async () => {
    await call('POST', 'day/submit', { memberId: A, date: today(), attendance: 'full_day', note: 'note', entries: [{ title: 't' }] });
    const r = await call('PUT', 'attendance', { memberId: A, date: today(), attendance: 'half_day' });
    assert.equal(r.status, 200);
    assert.equal(r.data.dayLog.attendance, 'half_day');
    assert.equal(r.data.dayLog.note, 'note');
  });

  test('only the admin gives verdicts; brownies ride along; null clears', async () => {
    const body = { memberId: A, date: today(), category: 'over_performed', overtime: true, holiday: false, hero: true };
    const nope = await call('PUT', 'marks', body);
    assert.equal(nope.status, 401);
    const r = await call('PUT', 'marks', body, admin);
    assert.equal(r.status, 200);
    assert.equal(r.data.mark.category, 'over_performed');
    assert.equal(r.data.mark.overtime, true);
    assert.equal(r.data.mark.hero, true);
    const past = await call('PUT', 'marks', { ...body, date: addDays(today(), -20) }, admin);
    assert.equal(past.status, 200, 'any past day can be judged');
    const bad = await call('PUT', 'marks', { ...body, category: 'great' }, admin);
    assert.equal(bad.status, 400);
    const cleared = await call('PUT', 'marks', { memberId: A, date: today(), category: null }, admin);
    assert.equal(cleared.data.mark, null);
    const hist = await call('GET', `history?from=${addDays(today(), -30)}`);
    assert.equal(hist.data.marks.length, 1);
  });

  test('passcode check', async () => {
    assert.equal((await call('POST', 'admin/verify', { passcode: 'wrong' })).data.error, 'Incorrect passcode.');
    assert.equal((await call('POST', 'admin/verify', { passcode: PASS })).data.ok, true);
    delete process.env.ADMIN_PASSCODE;
    assert.equal((await call('POST', 'admin/verify', { passcode: PASS })).status, 503);
    process.env.ADMIN_PASSCODE = PASS;
  });
});

describe('polling signature', () => {
  test('answers unchanged until something moves', async () => {
    const first = await call('GET', `day?date=${today()}`);
    const again = await call('GET', `day?date=${today()}&sig=${first.data.sig}`);
    assert.equal(again.data.unchanged, true);
    await call('POST', 'day/submit', { memberId: B, date: today(), attendance: 'leave', entries: [] });
    const moved = await call('GET', `day?date=${today()}&sig=${first.data.sig}`);
    assert.equal(moved.data.unchanged, undefined);
    assert.ok(Array.isArray(moved.data.members));
  });
});

describe('import from the old Supabase project', () => {
  const realFetch = globalThis.fetch;
  after(() => {
    globalThis.fetch = realFetch;
  });

  test('copies members, attendance, entries and verdicts, and can run twice', async () => {
    const X = '44444444-4444-4444-8444-444444444444';
    const E1 = '55555555-5555-4555-8555-555555555555';
    const fixtures: Record<string, unknown[]> = {
      members: [{ id: X, name: 'Kunal', title: '', active: true, created_at: '2026-10-01T00:00:00Z' }],
      day_logs: [{ id: '66666666-6666-4666-8666-666666666666', member_id: X, log_date: '2026-10-27', attendance: 'full_day', note: null, created_at: '2026-10-27T08:00:00Z', updated_at: '2026-10-27T08:00:00Z' }],
      entries: [{ id: E1, log_date: '2026-10-27', member_id: X, created_by: X, title: 'Exam Monitoring', details: 'au2', status: 'done', minutes: 60, remarks: null, attachment_path: null, attachment_name: null, attachment_type: null, attachment_size: null, status_by: null, status_at: null, created_at: '2026-10-27T09:22:00Z', updated_at: '2026-10-27T09:22:00Z' }],
      day_marks: [{ member_id: X, log_date: '2026-10-27', category: 'upto_mark', overtime: false, holiday: false, hero: false, marked_at: '2026-10-27T17:55:26Z' }],
    };
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      seen.push(`${url.pathname} ${(init?.headers as Record<string, string>)?.apikey}`);
      const table = url.pathname.split('/').pop() as string;
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return new Response(JSON.stringify(offset === 0 ? fixtures[table] ?? [] : []), { headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    const body = { sourceUrl: 'https://abcdefgh.supabase.co/', sourceKey: 'anon-key', scope: 'all' };
    assert.equal((await call('POST', 'admin/import', body)).status, 401);
    const r = await call('POST', 'admin/import', body, admin);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual([r.data.members, r.data.dayLogs, r.data.entries, r.data.marks], [1, 1, 1, 1]);
    assert.ok(seen.every((s) => s.endsWith('anon-key')));
    const again = await call('POST', 'admin/import', body, admin);
    assert.equal(again.status, 200);
    const day = await call('GET', 'day?date=2026-10-27');
    assert.equal(day.data.entries.length, 1);
    assert.equal(day.data.entries[0].title, 'Exam Monitoring');
    assert.equal(day.data.marks[0].category, 'upto_mark');
    const badUrl = await call('POST', 'admin/import', { sourceUrl: 'https://evil.example.com', sourceKey: 'k' }, admin);
    assert.equal(badUrl.status, 400);
  });

  test('team only (the default) copies members and leaves history behind', async () => {
    await pg.exec(`delete from day_marks; delete from entries; delete from day_logs; delete from members`);
    const Y = '77777777-7777-4777-8777-777777777777';
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const table = new URL(String(input)).pathname.split('/').pop() as string;
      asked.push(table);
      const rows: Record<string, unknown[]> = {
        members: [{ id: Y, name: 'Veni', title: null, active: true, created_at: '2026-10-01T00:00:00Z' }],
        entries: [{ id: '88888888-8888-4888-8888-888888888888', log_date: '2026-10-28', member_id: Y, title: 'Old work', status: 'done' }],
      };
      return new Response(JSON.stringify(rows[table] ?? []), { headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const r = await call('POST', 'admin/import', { sourceUrl: 'https://abcdefgh.supabase.co', sourceKey: 'anon-key' }, admin);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual([r.data.members, r.data.dayLogs, r.data.entries, r.data.marks], [1, 0, 0, 0]);
    assert.deepEqual(asked, ['members'], 'only the members table is read');
    const hist = await call('GET', 'history?from=2026-10-01');
    assert.equal(hist.data.entries.length, 0);
    assert.deepEqual(hist.data.members.map((m: { name: string }) => m.name), ['Veni']);
  });
});

describe('routing', () => {
  test('unknown routes and wrong methods', async () => {
    assert.equal((await call('GET', 'nope')).status, 404);
    assert.equal((await call('DELETE', 'day')).status, 405);
    const rewritten = await handle(new Request(`http://local/api?__path=setup`));
    assert.equal(rewritten.status, 200);
  });

  test('files need storage to be connected', async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const r = await call('POST', 'files/upload', { type: 'blob.generate-client-token', payload: { pathname: 'task-files/2026-11/x.pdf', clientPayload: null, multipart: false } });
    assert.equal(r.status, 503);
  });
});
