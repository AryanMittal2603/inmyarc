import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { setDb } from '../server/db.js';
import { handle } from '../server/router.js';
import { addDays, today } from '../server/time.js';

const PASS = 'Super@12345';
let pg: PGlite;

interface Res {
  status: number;
  data: any;
  setCookie: string | null;
}

async function call(method: string, path: string, body?: unknown, token?: string | null, type = 'application/json'): Promise<Res> {
  const headers: Record<string, string> = { 'Content-Type': type };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await handle(
    new Request(`http://local/api/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
  );
  const isJson = res.headers.get('content-type')?.includes('json');
  const setCookie = res.headers.get('set-cookie');
  return {
    status: res.status,
    data: isJson ? await res.json() : await res.text(),
    setCookie,
  };
}

const ok = (r: Res, status = 200) => assert.equal(r.status, status, JSON.stringify(r.data));

let admin = '';
let alphaId = '';
let betaId = '';
let alphaToken = '';
let betaToken = '';
// members
let ana = ''; // alpha
let ben = ''; // alpha
let cara = ''; // beta
let drew = ''; // unassigned

async function signInManager(team: string, password: string): Promise<string> {
  const r = await call('POST', 'auth/manager', { team, password });
  ok(r);
  assert.equal(r.data.role, 'manager');
  return r.data.token as string;
}

before(async () => {
  pg = new PGlite();
  setDb({ query: async (text, params = []) => (await pg.query(text, params as never[])).rows as never });
  process.env.ADMIN_PASSCODE = PASS;
  delete process.env.EDITABLE_FROM;
  delete process.env.SESSION_SECRET;
});
after(async () => {
  await pg.close();
});

describe('setup', () => {
  test('creates the schema and reports an empty database', async () => {
    const r = await call('GET', 'setup');
    ok(r);
    assert.equal(r.data.database, true);
    assert.equal(r.data.ready, true);
    assert.equal(r.data.admin, true);
    assert.equal(r.data.managers, 0);
    assert.equal(r.data.members, 0);
    assert.equal(r.data.openFrom, today());
  });
});

describe('super admin sign-in', () => {
  test('wrong password, right password; a token, never a cookie', async () => {
    const wrong = await call('POST', 'auth/admin', { password: 'nope' });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.data.error, 'Incorrect password.');
    assert.equal(wrong.data.token, undefined);

    const r = await call('POST', 'auth/admin', { password: PASS });
    ok(r);
    assert.equal(r.setCookie, null, 'nothing is remembered by the browser');
    assert.equal(r.data.role, 'admin');
    assert.match(r.data.token, /^[\w-]+\.[\w-]+$/);
    const hours = (r.data.expiresAt - Date.now()) / 3_600_000;
    assert.ok(hours > 11.9 && hours <= 12, `token lasts 12 hours (${hours})`);
    admin = r.data.token as string;
    const s = await call('GET', 'auth/session', undefined, admin);
    assert.equal(s.data.admin, true);
    assert.equal(s.data.manager, null);
    assert.equal((await call('GET', 'auth/session')).data.admin, false);
  });

  test('tampered tokens are ignored; changing ADMIN_PASSCODE signs everyone out', async () => {
    const [body, mac] = admin.split('.');
    const forged = `${Buffer.from(JSON.stringify({ r: 'a', f: 'x', v: 1, e: 9e12 })).toString('base64url')}.${mac}`;
    assert.equal((await call('GET', 'admin/overview', undefined, forged)).status, 401);
    assert.equal((await call('GET', 'admin/overview', undefined, `${body}.AAAA`)).status, 401);
    const asCookie = await handle(new Request('http://local/api/admin/overview', { headers: { Cookie: `iv_admin=${admin}` } }));
    assert.equal(asCookie.status, 401, 'cookies are not read at all');

    process.env.ADMIN_PASSCODE = 'Changed@12345';
    assert.equal((await call('GET', 'admin/overview', undefined, admin)).status, 401);
    process.env.ADMIN_PASSCODE = PASS;
    ok(await call('GET', 'admin/overview', undefined, admin));
  });

  test('without ADMIN_PASSCODE nobody can sign in', async () => {
    delete process.env.ADMIN_PASSCODE;
    assert.equal((await call('POST', 'auth/admin', { password: PASS })).status, 503);
    assert.equal((await call('GET', 'admin/overview', undefined, admin)).status, 503);
    process.env.ADMIN_PASSCODE = PASS;
  });

  test('signing out ends that sign-in everywhere', async () => {
    const other = (await call('POST', 'auth/admin', { password: PASS })).data.token as string;
    ok(await call('POST', 'auth/logout', {}, other));
    assert.equal((await call('GET', 'admin/overview', undefined, other)).status, 401);
    assert.equal((await call('GET', 'admin/overview', undefined, admin)).status, 401, 'other tabs too');
    admin = (await call('POST', 'auth/admin', { password: PASS })).data.token as string;
    ok(await call('GET', 'admin/overview', undefined, admin));
    ok(await call('POST', 'auth/logout', {}), 200);
  });
});

describe('managers and employees (super admin)', () => {
  test('only the super admin can manage people', async () => {
    assert.equal((await call('GET', 'admin/overview')).status, 401);
    assert.equal((await call('POST', 'admin/managers', { name: 'X', slug: 'x', password: 'password1' })).status, 401);
    assert.equal((await call('POST', 'admin/members', { name: 'X' })).status, 401);
  });

  test('creates managers with link names and passwords', async () => {
    const a = await call('POST', 'admin/managers', { name: '  Asha   Rao ', slug: ' Alpha ', password: 'alpha-pass-1' }, admin);
    ok(a, 201);
    assert.equal(a.data.manager.name, 'Asha Rao');
    assert.equal(a.data.manager.slug, 'alpha', 'link names are lowercased');
    assert.equal(a.data.manager.members, 0);
    assert.equal(a.data.manager.password_hash, undefined, 'hashes never leave the server');
    alphaId = a.data.manager.id;

    const b = await call('POST', 'admin/managers', { name: 'Bilal', slug: 'beta', password: 'beta-pass-1' }, admin);
    ok(b, 201);
    betaId = b.data.manager.id;

    const dupe = await call('POST', 'admin/managers', { name: 'Other', slug: 'alpha', password: 'password1' }, admin);
    assert.equal(dupe.status, 409);
    assert.match(dupe.data.error, /already used/);
    assert.equal((await call('POST', 'admin/managers', { name: 'X', slug: 'has space', password: 'password1' }, admin)).status, 400);
    assert.equal((await call('POST', 'admin/managers', { name: 'X', slug: '-dash', password: 'password1' }, admin)).status, 400);
    const short = await call('POST', 'admin/managers', { name: 'X', slug: 'gamma', password: 'short' }, admin);
    assert.equal(short.data.error, 'Use a password of at least 8 characters.');
    assert.equal((await call('POST', 'admin/managers', { name: ' ', slug: 'gamma', password: 'password1' }, admin)).status, 400);

    const stored = await pg.query<{ password_hash: string }>(`select password_hash from managers where slug = 'alpha'`);
    assert.match(stored.rows[0].password_hash, /^scrypt\$/);
  });

  test('adds employees under managers; names are unique within a team', async () => {
    const add = async (name: string, managerId: string | null) => {
      const r = await call('POST', 'admin/members', { name, managerId }, admin);
      ok(r, 201);
      return r.data.member.id as string;
    };
    ana = await add('Ana', alphaId);
    ben = await add('Ben', alphaId);
    cara = await add('Cara', betaId);
    drew = await add('Drew', null);

    const dupe = await call('POST', 'admin/members', { name: 'ana', managerId: alphaId }, admin);
    assert.equal(dupe.status, 409);
    ok(await call('POST', 'admin/members', { name: 'Ana', managerId: betaId }, admin), 201);
    const badManager = await call('POST', 'admin/members', { name: 'Eve', managerId: '99999999-9999-4999-8999-999999999999' }, admin);
    assert.equal(badManager.status, 404);
    assert.equal((await call('POST', 'admin/members', { name: 'Eve', managerId: 'nope' }, admin)).status, 400);

    const o = await call('GET', 'admin/overview', undefined, admin);
    ok(o);
    const counts = Object.fromEntries(o.data.managers.map((m: { slug: string; members: number }) => [m.slug, m.members]));
    assert.deepEqual(counts, { alpha: 2, beta: 2 });
    assert.equal(o.data.members.length, 5);
    assert.equal(o.data.members.find((m: { name: string }) => m.name === 'Drew').manager_id, null);
    assert.equal(o.data.settings.openFrom, today());
  });

  test('moves, renames and deactivates employees', async () => {
    const extra = await call('POST', 'admin/members', { name: 'Temp', managerId: alphaId }, admin);
    const id = extra.data.member.id;
    const moved = await call('PATCH', `admin/members/${id}`, { managerId: betaId, name: '  Temp  Two ' }, admin);
    ok(moved);
    assert.equal(moved.data.member.manager_id, betaId);
    assert.equal(moved.data.member.name, 'Temp Two');
    const clash = await call('PATCH', `admin/members/${id}`, { name: 'Cara' }, admin);
    assert.equal(clash.status, 409);
    const off = await call('PATCH', `admin/members/${id}`, { active: false }, admin);
    assert.equal(off.data.member.active, false);
    ok(await call('DELETE', `admin/members/${id}`, undefined, admin));
    assert.equal((await call('DELETE', `admin/members/${id}`, undefined, admin)).status, 404);
  });
});

describe('manager sign-in', () => {
  test('wrong team, wrong password, right password', async () => {
    assert.equal((await call('POST', 'auth/manager', { team: 'nope', password: 'alpha-pass-1' })).status, 404);
    const wrong = await call('POST', 'auth/manager', { team: 'alpha', password: 'beta-pass-1' });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.data.error, 'Incorrect password.');
    const r = await call('POST', 'auth/manager', { team: 'alpha', password: 'alpha-pass-1' });
    ok(r);
    assert.equal(r.setCookie, null);
    assert.equal(r.data.role, 'manager');
    alphaToken = r.data.token as string;
    betaToken = await signInManager('beta', 'beta-pass-1');
    const s = await call('GET', 'auth/session?team=alpha', undefined, alphaToken);
    assert.deepEqual(s.data.manager, { name: 'Asha Rao', slug: 'alpha' });
    assert.deepEqual(s.data.team, { name: 'Asha Rao', slug: 'alpha' });
    assert.equal(s.data.admin, false);
  });

  test('the super admin’s password also opens any manager page', async () => {
    const r = await call('POST', 'auth/manager', { team: 'beta', password: PASS });
    ok(r);
    assert.equal(r.data.role, 'admin');
    ok(await call('GET', 'admin/overview', undefined, r.data.token));
  });

  test('a manager signing out ends their sign-in in every tab', async () => {
    const one = await signInManager('alpha', 'alpha-pass-1');
    const two = await signInManager('alpha', 'alpha-pass-1');
    ok(await call('POST', 'auth/logout', {}, one));
    assert.equal((await call('GET', 'auth/session', undefined, two)).data.manager, null);
    assert.equal((await call('GET', 'auth/session', undefined, alphaToken)).data.manager, null);
    alphaToken = await signInManager('alpha', 'alpha-pass-1');
    assert.equal((await call('GET', 'auth/session', undefined, alphaToken)).data.manager.slug, 'alpha');
  });

  test('managers cannot use the super admin pages', async () => {
    assert.equal((await call('GET', 'admin/overview', undefined, alphaToken)).status, 401);
    assert.equal((await call('GET', `day?date=${today()}&team=*`, undefined, alphaToken)).status, 401);
  });

  test('a password reset signs the manager out', async () => {
    const before = await signInManager('beta', 'beta-pass-1');
    ok(await call('PATCH', `admin/managers/${betaId}`, { password: 'beta-pass-2' }, admin));
    assert.equal((await call('GET', 'auth/session', undefined, before)).data.manager, null);
    assert.equal((await call('POST', 'auth/manager', { team: 'beta', password: 'beta-pass-1' })).status, 401);
    betaToken = await signInManager('beta', 'beta-pass-2');
  });

  test('a deactivated team disappears until it is switched back on', async () => {
    const r = await call('PATCH', `admin/managers/${betaId}`, { active: false }, admin);
    ok(r);
    assert.equal(r.data.manager.active, false);
    assert.equal((await call('GET', 'auth/session', undefined, betaToken)).data.manager, null);
    assert.equal((await call('POST', 'auth/manager', { team: 'beta', password: 'beta-pass-2' })).status, 404);
    assert.equal((await call('GET', `day?date=${today()}&team=beta`)).status, 404);
    assert.deepEqual((await call('GET', 'teams')).data.teams.map((t: { slug: string }) => t.slug), ['alpha']);
    ok(await call('PATCH', `admin/managers/${betaId}`, { active: true }, admin));
    betaToken = await signInManager('beta', 'beta-pass-2');
  });

  test('link names can be changed, but not to one in use', async () => {
    assert.equal((await call('PATCH', `admin/managers/${betaId}`, { slug: 'alpha' }, admin)).status, 409);
    const r = await call('PATCH', `admin/managers/${betaId}`, { slug: 'beta-team', name: 'Bilal K' }, admin);
    ok(r);
    assert.equal(r.data.manager.slug, 'beta-team');
    assert.equal((await call('GET', `day?date=${today()}&team=beta`)).status, 404);
    ok(await call('GET', `day?date=${today()}&team=beta-team`));
    ok(await call('PATCH', `admin/managers/${betaId}`, { slug: 'beta' }, admin));
    assert.equal((await call('GET', 'auth/session', undefined, betaToken)).data.manager.slug, 'beta', 'renames keep you signed in');
  });
});

describe('team boards', () => {
  test('the home page lists active teams', async () => {
    const r = await call('GET', 'teams');
    ok(r);
    assert.deepEqual(r.data.teams, [
      { name: 'Asha Rao', slug: 'alpha', members: 2, reported: 0 },
      { name: 'Bilal K', slug: 'beta', members: 2, reported: 0 },
    ]);
    assert.equal(r.data.today, today());
  });

  test('each board only shows its own team', async () => {
    const a = await call('GET', `day?date=${today()}&team=alpha`);
    ok(a);
    assert.deepEqual(a.data.members.map((m: { name: string }) => m.name), ['Ana', 'Ben']);
    assert.equal(a.data.team.slug, 'alpha');
    assert.deepEqual(a.data.teams, []);
    assert.equal((await call('GET', `day?date=${today()}&team=nope`)).status, 404);
    assert.equal((await call('GET', `day?date=${today()}`)).status, 404, 'a team is required');
    assert.equal((await call('GET', `day?date=${today()}&team=ALPHA`)).status, 404);
  });

  test('the super admin can see everyone at once', async () => {
    const r = await call('GET', `day?date=${today()}&team=*`, undefined, admin);
    ok(r);
    assert.deepEqual(r.data.members.map((m: { name: string }) => m.name), ['Ana', 'Ana', 'Ben', 'Cara', 'Drew']);
    assert.equal(r.data.team, null);
    assert.deepEqual(r.data.teams.map((t: { slug: string }) => t.slug), ['alpha', 'beta']);
  });
});

describe('logging a day', () => {
  beforeEach(async () => {
    await pg.exec(`delete from entries; delete from day_logs; delete from day_marks; delete from settings where key = 'editable_from'`);
    delete process.env.EDITABLE_FROM;
  });

  test('saves attendance, note and entries in order', async () => {
    const r = await call('POST', 'day/submit', {
      team: 'alpha',
      memberId: ana,
      date: today(),
      attendance: 'wfh',
      note: '  Exams day  ',
      entries: [
        { title: 'First', details: 'one', status: 'done', minutes: 90 },
        { title: '   ', details: 'ignored, no title' },
        { title: 'Second', status: 'rework', minutes: 5000 },
      ],
    });
    ok(r);
    assert.equal(r.data.count, 2);
    const day = await call('GET', `day?date=${today()}&team=alpha`);
    assert.deepEqual(day.data.entries.map((e: { title: string }) => e.title), ['First', 'Second']);
    assert.equal(day.data.entries[0].created_by, ana);
    assert.equal(day.data.entries[1].minutes, 1440, 'minutes are clamped to a day');
    assert.equal(day.data.dayLogs[0].attendance, 'wfh');
    assert.equal(day.data.dayLogs[0].note, 'Exams day');
    const other = await call('GET', `day?date=${today()}&team=beta`);
    assert.equal(other.data.entries.length, 0, 'other teams never see it');
  });

  test('a team board can only write for its own people', async () => {
    const body = { memberId: cara, date: today(), attendance: 'leave', entries: [] };
    const wrong = await call('POST', 'day/submit', { ...body, team: 'alpha' });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.data.error, 'That person isn’t on this team.');
    assert.equal((await call('POST', 'day/submit', body)).status, 403, 'no team, no write');
    assert.equal((await call('POST', 'day/submit', { ...body, memberId: drew, team: 'alpha' })).status, 403, 'unassigned people');
    ok(await call('POST', 'day/submit', { ...body, team: 'beta' }));
    ok(await call('POST', 'day/submit?team=beta', body), 200);
  });

  test('needs an entry unless the day is off', async () => {
    const r = await call('POST', 'day/submit', { team: 'alpha', memberId: ana, date: today(), attendance: 'full_day', entries: [] });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, 'Add at least one entry, or mark the day as off.');
    const off = await call('POST', 'day/submit', { team: 'alpha', memberId: ana, date: today(), attendance: 'leave', entries: [] });
    ok(off);
    assert.equal(off.data.count, 0);
  });

  test('past days: locked for the board, open to that team’s manager and the super admin', async () => {
    const y = addDays(today(), -1);
    const body = { team: 'alpha', memberId: ana, date: y, attendance: 'full_day', entries: [{ title: 'Late', status: 'done' }] };
    const locked = await call('POST', 'day/submit', body);
    assert.equal(locked.status, 403);
    assert.equal(locked.data.error, 'This day is locked. Your manager can change it from their page.');
    assert.equal((await call('POST', 'day/submit', body, betaToken)).status, 403, 'another team’s manager is just a visitor here');
    ok(await call('POST', 'day/submit', body, alphaToken));
    ok(await call('POST', 'day/submit', { ...body, team: undefined, memberId: ben }, alphaToken));
    ok(await call('POST', 'day/submit', { ...body, team: undefined, memberId: cara }, admin));
    assert.equal((await call('POST', 'day/submit', { ...body, team: undefined, memberId: cara }, alphaToken)).status, 403);
  });

  test('the backfill window: EDITABLE_FROM, overridden by the dashboard setting', async () => {
    const y = addDays(today(), -1);
    const body = { team: 'alpha', memberId: ana, date: y, attendance: 'full_day', entries: [{ title: 'Backfill', status: 'done' }] };
    process.env.EDITABLE_FROM = addDays(today(), -5);
    ok(await call('POST', 'day/submit', body));
    assert.equal((await call('GET', `day?date=${y}&team=alpha`)).data.openFrom, addDays(today(), -5));

    assert.equal((await call('PUT', 'admin/settings', { editableFrom: today() }, alphaToken)).status, 401);
    const set = await call('PUT', 'admin/settings', { editableFrom: today() }, admin);
    ok(set);
    assert.deepEqual(set.data, { editableFrom: today(), openFrom: today() });
    assert.equal((await call('POST', 'day/submit', body)).status, 403);
    assert.equal((await call('PUT', 'admin/settings', { editableFrom: addDays(today(), 2) }, admin)).status, 400);
    const cleared = await call('PUT', 'admin/settings', { editableFrom: null }, admin);
    assert.equal(cleared.data.openFrom, addDays(today(), -5), 'falls back to EDITABLE_FROM');
  });

  test('future days are refused, even for the super admin', async () => {
    const r = await call('POST', 'day/submit', { memberId: ana, date: addDays(today(), 1), attendance: 'leave', entries: [] }, admin);
    assert.equal(r.status, 400);
  });

  test('validates fields', async () => {
    const base = { team: 'alpha', memberId: ana, date: today(), attendance: 'full_day' };
    assert.equal((await call('POST', 'day/submit', { ...base, entries: [{ title: 'x'.repeat(181) }] })).status, 400);
    assert.equal((await call('POST', 'day/submit', { ...base, attendance: 'nope', entries: [] })).status, 400);
    assert.equal((await call('POST', 'day/submit', { ...base, memberId: 'x', attendance: 'leave' })).status, 400);
    assert.equal((await call('POST', 'day/submit', { ...base, date: '2026-02-30', attendance: 'leave' })).status, 400);
    const ghost = await call('POST', 'day/submit', { ...base, memberId: '99999999-9999-4999-8999-999999999999', attendance: 'leave' });
    assert.equal(ghost.status, 404);
    const badFile = await call('POST', 'day/submit', { ...base, entries: [{ title: 'With file', attachment: { path: '../etc/passwd', name: 'x', size: 10 } }] });
    assert.equal(badFile.status, 400);
    const path = 'task-files/2026-11/0b7c9a2e-1111-4111-8111-111111111111.pdf';
    const bigFile = await call('POST', 'day/submit', { ...base, entries: [{ title: 'With file', attachment: { path, name: 'big.pdf', size: 11 * 1024 * 1024 } }] });
    assert.equal(bigFile.status, 400);
    assert.match(bigFile.data.error, /too big/);
    ok(await call('POST', 'day/submit', { ...base, entries: [{ title: 'With file', attachment: { path, name: 'report.pdf', type: 'application/pdf', size: 2048 } }] }));
    const day = await call('GET', `day?date=${today()}&team=alpha`);
    assert.equal(day.data.entries[0].attachment_name, 'report.pdf');
    assert.equal(day.data.entries[0].attachment_size, 2048);
  });
});

describe('editing entries', () => {
  let id: string;
  beforeEach(async () => {
    await pg.exec(`delete from entries; delete from day_logs; delete from day_marks`);
    const r = await call('POST', 'entries', { team: 'alpha', memberId: ben, date: today(), title: 'Write report', details: 'brief', assigned: true });
    ok(r, 201);
    id = r.data.entry.id;
  });

  test('assigned tasks start as Not done with no author', async () => {
    const e = (await call('GET', `day?date=${today()}&team=alpha`)).data.entries[0];
    assert.equal(e.created_by, null);
    assert.equal(e.status, 'not_done');
    assert.equal(e.minutes, null);
  });

  test('status changes record who and when', async () => {
    const r = await call('PATCH', `entries/${id}?team=alpha`, { status: 'done', statusChanged: true, actorId: ana });
    ok(r);
    assert.equal(r.data.entry.status_by, ana);
    assert.ok(r.data.entry.status_at);
    const stale = await call('PATCH', `entries/${id}?team=alpha`, { status: 'rework', statusChanged: true, actorId: '99999999-9999-4999-8999-999999999999' });
    assert.equal(stale.data.entry.status_by, null, 'unknown actors are dropped, not rejected');
  });

  test('remarks are trimmed and cut at 500', async () => {
    const r = await call('PATCH', `entries/${id}`, { team: 'alpha', remarks: `  ${'y'.repeat(600)}  ` });
    assert.equal(r.data.entry.remarks.length, 500);
    const cleared = await call('PATCH', `entries/${id}`, { team: 'alpha', remarks: '   ' });
    assert.equal(cleared.data.entry.remarks, null);
  });

  test('full edit, attachment removal, and title rules', async () => {
    const r = await call('PATCH', `entries/${id}?team=alpha`, { title: 'Report v2', details: '', minutes: 45, status: 'done', statusChanged: false });
    assert.equal(r.data.entry.title, 'Report v2');
    assert.equal(r.data.entry.details, null);
    assert.equal(r.data.entry.minutes, 45);
    assert.equal(r.data.entry.status_by, null);
    const empty = await call('PATCH', `entries/${id}?team=alpha`, { title: '  ' });
    assert.equal(empty.status, 400);
    assert.equal(empty.data.error, 'A task needs a title.');
    const cleared = await call('PATCH', `entries/${id}?team=alpha`, { attachment: null });
    assert.equal(cleared.data.entry.attachment_path, null);
  });

  test('other teams cannot touch it', async () => {
    assert.equal((await call('PATCH', `entries/${id}?team=beta`, { remarks: 'x' })).status, 403);
    assert.equal((await call('DELETE', `entries/${id}?team=beta`)).status, 403);
    assert.equal((await call('DELETE', `entries/${id}`, undefined, betaToken)).status, 403);
  });

  test('past entries are locked for the board but not for the manager', async () => {
    await pg.query(`update entries set log_date = $2 where id = $1`, [id, addDays(today(), -3)]);
    assert.equal((await call('PATCH', `entries/${id}?team=alpha`, { remarks: 'hi' })).status, 403);
    assert.equal((await call('DELETE', `entries/${id}?team=alpha`)).status, 403);
    ok(await call('PATCH', `entries/${id}`, { remarks: 'hi' }, alphaToken));
    ok(await call('DELETE', `entries/${id}`, undefined, alphaToken));
    assert.equal((await call('PATCH', `entries/${id}`, { remarks: 'again' }, admin)).status, 404);
  });

  test('assign needs a person and a task', async () => {
    const noOne = await call('POST', 'entries', { team: 'alpha', date: today(), title: 'x', assigned: true });
    assert.equal(noOne.data.error, 'Choose who the task is for.');
    const noTask = await call('POST', 'entries', { team: 'alpha', memberId: ben, date: today(), title: ' ', assigned: true });
    assert.equal(noTask.data.error, 'Describe the task.');
  });
});

describe('attendance and verdicts', () => {
  beforeEach(async () => {
    await pg.exec(`delete from entries; delete from day_logs; delete from day_marks`);
  });

  test('attendance upserts and keeps the note', async () => {
    await call('POST', 'day/submit', { team: 'alpha', memberId: ana, date: today(), attendance: 'full_day', note: 'note', entries: [{ title: 't' }] });
    const r = await call('PUT', 'attendance', { team: 'alpha', memberId: ana, date: today(), attendance: 'half_day' });
    ok(r);
    assert.equal(r.data.dayLog.attendance, 'half_day');
    assert.equal(r.data.dayLog.note, 'note');
    assert.equal((await call('PUT', 'attendance', { team: 'beta', memberId: ana, date: today(), attendance: 'leave' })).status, 403);
  });

  test('only the team’s manager or the super admin gives verdicts', async () => {
    const body = { memberId: ana, date: today(), category: 'over_performed', overtime: true, holiday: false, hero: true };
    assert.equal((await call('PUT', 'marks', { ...body, team: 'alpha' })).status, 401);
    const other = await call('PUT', 'marks', body, betaToken);
    assert.equal(other.status, 403);
    assert.equal(other.data.error, 'Only this person’s manager can give verdicts.');

    const r = await call('PUT', 'marks', body, alphaToken);
    ok(r);
    assert.equal(r.data.mark.category, 'over_performed');
    assert.equal(r.data.mark.overtime, true);
    assert.equal(r.data.mark.hero, true);
    const by = await pg.query<{ marked_by: string }>(`select marked_by from day_marks where member_id = $1`, [ana]);
    assert.equal(by.rows[0].marked_by, 'manager:alpha');

    ok(await call('PUT', 'marks', { ...body, date: addDays(today(), -20) }, alphaToken), 200);
    ok(await call('PUT', 'marks', { ...body, memberId: cara }, admin));
    const byAdmin = await pg.query<{ marked_by: string }>(`select marked_by from day_marks where member_id = $1`, [cara]);
    assert.equal(byAdmin.rows[0].marked_by, 'admin');
    assert.equal((await call('PUT', 'marks', { ...body, category: 'great' }, alphaToken)).status, 400);
    assert.equal((await call('PUT', 'marks', { ...body, date: addDays(today(), 1) }, admin)).status, 400);

    const cleared = await call('PUT', 'marks', { memberId: ana, date: today(), category: null }, alphaToken);
    assert.equal(cleared.data.mark, null);
    const hist = await call('GET', `history?from=${addDays(today(), -30)}&team=alpha`);
    assert.equal(hist.data.marks.length, 1);
    assert.deepEqual(hist.data.members.map((m: { name: string }) => m.name), ['Ana', 'Ben']);
    const all = await call('GET', `history?from=${addDays(today(), -30)}&team=*`, undefined, admin);
    assert.equal(all.data.marks.length, 2);
    assert.equal((await call('GET', `history?from=${addDays(today(), -30)}&team=*`)).status, 401);
  });
});

describe('employees with history', () => {
  test('cannot be deleted, only deactivated; deleting a manager leaves the team unassigned', async () => {
    await call('POST', 'day/submit', { team: 'beta', memberId: cara, date: today(), attendance: 'leave', entries: [] });
    const del = await call('DELETE', `admin/members/${cara}`, undefined, admin);
    assert.equal(del.status, 409);
    assert.match(del.data.error, /Deactivate them instead/);
    const o = await call('GET', 'admin/overview', undefined, admin);
    assert.equal(o.data.members.find((m: { id: string }) => m.id === cara).has_history, true);

    const temp = await call('POST', 'admin/managers', { name: 'Temp', slug: 'temp', password: 'password1' }, admin);
    const tempId = temp.data.manager.id;
    const m = await call('POST', 'admin/members', { name: 'Tia', managerId: tempId }, admin);
    ok(await call('DELETE', `admin/managers/${tempId}`, undefined, admin));
    const after = await call('GET', 'admin/overview', undefined, admin);
    assert.equal(after.data.members.find((x: { id: string }) => x.id === m.data.member.id).manager_id, null);
    assert.equal((await call('DELETE', `admin/managers/${tempId}`, undefined, admin)).status, 404);
  });
});

describe('polling signature', () => {
  test('answers unchanged until something on that team moves', async () => {
    const first = await call('GET', `day?date=${today()}&team=alpha`);
    const again = await call('GET', `day?date=${today()}&team=alpha&sig=${first.data.sig}`);
    assert.equal(again.data.unchanged, true);
    await call('POST', 'day/submit', { team: 'beta', memberId: cara, date: today(), attendance: 'wfh', entries: [{ title: 'Beta work' }] });
    const still = await call('GET', `day?date=${today()}&team=alpha&sig=${first.data.sig}`);
    assert.equal(still.data.unchanged, true, 'other teams do not wake this board');
    await call('POST', 'day/submit', { team: 'alpha', memberId: ben, date: today(), attendance: 'leave', entries: [] });
    const moved = await call('GET', `day?date=${today()}&team=alpha&sig=${first.data.sig}`);
    assert.equal(moved.data.unchanged, undefined);
    assert.ok(Array.isArray(moved.data.members));
    const teams = await call('GET', 'teams');
    const reported = Object.fromEntries(teams.data.teams.map((t: { slug: string; reported: number }) => [t.slug, t.reported]));
    assert.deepEqual(reported, { alpha: 1, beta: 1 }, 'the home page counts who logged today');
  });

  test('the home page gets today\'s pulse without names or titles', async () => {
    const before = (await call('GET', 'teams')).data.pulse;
    assert.equal(before.tasks, before.done + before.rework + before.notDone);
    assert.equal(before.times.length, before.tasks);
    await call('POST', 'entries', { team: 'alpha', memberId: ana, date: today(), title: 'Pulse check', status: 'rework', minutes: 25 });
    const after = (await call('GET', 'teams')).data.pulse;
    assert.equal(after.tasks, before.tasks + 1);
    assert.equal(after.rework, before.rework + 1);
    assert.equal(after.minutes, before.minutes + 25);
    const [at, status] = after.times[after.times.length - 1];
    const now = new Date();
    const ist = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % 1440;
    assert.equal(status, 'rework');
    assert.ok(Math.abs(at - ist) <= 2 || Math.abs(at - ist) >= 1438, `logged at ${at}, now ${ist}`);
    assert.ok(!JSON.stringify(after).includes('Pulse check'), 'no titles');
    assert.ok(!JSON.stringify(after).includes('Ana'), 'no names');
  });
});

describe('import from the old Supabase project', () => {
  const realFetch = globalThis.fetch;
  after(() => {
    globalThis.fetch = realFetch;
  });

  test('copies history into a team and can run twice', async () => {
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

    const body = { sourceUrl: 'https://abcdefgh.supabase.co/', sourceKey: 'anon-key', scope: 'all', managerId: alphaId };
    assert.equal((await call('POST', 'admin/import', body)).status, 401);
    assert.equal((await call('POST', 'admin/import', body, alphaToken)).status, 401);
    const r = await call('POST', 'admin/import', body, admin);
    ok(r);
    assert.deepEqual([r.data.members, r.data.dayLogs, r.data.entries, r.data.marks], [1, 1, 1, 1]);
    assert.ok(seen.every((s) => s.endsWith('anon-key')));
    ok(await call('POST', 'admin/import', body, admin));
    const day = await call('GET', 'day?date=2026-10-27&team=alpha');
    assert.equal(day.data.entries.length, 1);
    assert.equal(day.data.entries[0].title, 'Exam Monitoring');
    assert.equal(day.data.marks[0].category, 'upto_mark');
    assert.ok(day.data.members.some((m: { name: string }) => m.name === 'Kunal'));
    const badUrl = await call('POST', 'admin/import', { sourceUrl: 'https://evil.example.com', sourceKey: 'k' }, admin);
    assert.equal(badUrl.status, 400);
  });

  test('team only (the default) copies people and leaves history behind', async () => {
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
    const r = await call('POST', 'admin/import', { sourceUrl: 'https://abcdefgh.supabase.co', sourceKey: 'anon-key', managerId: betaId }, admin);
    ok(r);
    assert.deepEqual([r.data.members, r.data.dayLogs, r.data.entries, r.data.marks], [1, 0, 0, 0]);
    assert.deepEqual(asked, ['members'], 'only the members table is read');
    const hist = await call('GET', 'history?from=2026-10-01&team=beta');
    assert.equal(hist.data.entries.filter((e: { title: string }) => e.title === 'Old work').length, 0);
    assert.ok(hist.data.members.some((m: { name: string }) => m.name === 'Veni'));
  });
});

describe('routing', () => {
  test('unknown routes, wrong methods, rewritten paths', async () => {
    assert.equal((await call('GET', 'nope')).status, 404);
    assert.equal((await call('DELETE', 'day')).status, 405);
    const rewritten = await handle(new Request(`http://local/api?__path=setup`));
    assert.equal(rewritten.status, 200);
  });

  test('writes must be JSON', async () => {
    const r = await call('POST', 'auth/admin', { password: PASS }, null, 'text/plain');
    assert.equal(r.status, 415);
    assert.equal(r.setCookie, null);
  });

  test('files need storage to be connected', async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const r = await call('POST', 'files/upload', { type: 'blob.generate-client-token', payload: { pathname: 'task-files/2026-11/x.pdf', clientPayload: null, multipart: false } });
    assert.equal(r.status, 503);
  });
});
