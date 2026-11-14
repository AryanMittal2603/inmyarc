import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { Db } from './db.js';
import { env } from './env.js';

/*
 * Two kinds of sign-in, both asked for every time the page is opened:
 *   super admin — password = ADMIN_PASSCODE
 *   manager     — password set by the super admin, stored as a scrypt hash
 * A successful sign-in returns a signed token (HMAC-SHA256, 12 hours) that the page keeps in
 * memory only and sends as "Authorization: Bearer …". Nothing is stored in the browser, so a
 * reload, a new tab or coming back later means entering the password again.
 * Signing out, a password reset or turning a team off ends the manager's tokens
 * (session_version); signing out or changing ADMIN_PASSCODE ends the super admin's.
 */

const TTL = 12 * 60 * 60;

export interface ManagerSession {
  managerId: string;
  slug: string;
  name: string;
}

export interface Sessions {
  admin: boolean;
  manager: ManagerSession | null;
}

export interface IssuedToken {
  token: string;
  /** Unix time in ms. */
  expiresAt: number;
}

/* ───────── passwords (scrypt) ───────── */

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) => (error ? reject(error) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, salt, key] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/* ───────── super admin passcode ───────── */

export function passcodeConfigured(): boolean {
  return env.adminPasscode() !== '';
}

export function checkPasscode(candidate: string | null | undefined): boolean {
  const expected = env.adminPasscode();
  if (!expected || !candidate) return false;
  const a = createHash('sha256').update(candidate, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

/* ───────── signed tokens ───────── */

let cachedSecret: string | null = null;

/** Tests swap databases; forget the cached secret with them. */
export function resetAuthCache(): void {
  cachedSecret = null;
}

async function secret(d: Db): Promise<string> {
  const fromEnv = env.sessionSecret();
  if (fromEnv) return fromEnv;
  if (cachedSecret) return cachedSecret;
  await d.query(`insert into settings (key, value) values ('session_secret', $1) on conflict (key) do nothing`, [
    randomBytes(32).toString('hex'),
  ]);
  const [row] = await d.query<{ value: string }>(`select value from settings where key = 'session_secret'`);
  cachedSecret = row.value;
  return cachedSecret;
}

function sign(key: string, payload: object): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const mac = createHmac('sha256', key).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function unsign<T>(key: string, token: string): T | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = createHmac('sha256', key).update(body).digest();
  const actual = Buffer.from(mac, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

const now = () => Math.floor(Date.now() / 1000);

function adminFingerprint(key: string): string {
  return createHmac('sha256', key).update(`admin:${env.adminPasscode()}`).digest('base64url').slice(0, 22);
}

async function adminVersion(d: Db): Promise<number> {
  const [row] = await d.query<{ value: string | null }>(`select value from settings where key = 'admin_session_version'`);
  return Number(row?.value) || 1;
}

export async function adminToken(d: Db): Promise<IssuedToken> {
  const key = await secret(d);
  const e = now() + TTL;
  return { token: sign(key, { r: 'a', f: adminFingerprint(key), v: await adminVersion(d), e }), expiresAt: e * 1000 };
}

export async function managerToken(d: Db, manager: { id: string; session_version: number }): Promise<IssuedToken> {
  const key = await secret(d);
  const e = now() + TTL;
  return { token: sign(key, { r: 'm', m: manager.id, v: manager.session_version, e }), expiresAt: e * 1000 };
}

interface TokenPayload {
  r: string;
  e: number;
  f?: string;
  v?: number;
  m?: string;
}

function bearer(request: Request): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '');
  return match ? match[1] : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readToken(request: Request, d: Db): Promise<TokenPayload | null> {
  const token = bearer(request);
  if (!token) return null;
  const p = unsign<TokenPayload>(await secret(d), token);
  return p && typeof p.e === 'number' && p.e > now() ? p : null;
}

/** Who this request is signed in as (from its bearer token). */
export async function sessionsOf(request: Request, d: Db): Promise<Sessions> {
  const result: Sessions = { admin: false, manager: null };
  const p = await readToken(request, d);
  if (!p) return result;
  if (p.r === 'a') {
    const key = await secret(d);
    result.admin = passcodeConfigured() && p.f === adminFingerprint(key) && p.v === (await adminVersion(d));
  } else if (p.r === 'm' && typeof p.m === 'string' && UUID.test(p.m)) {
    const [m] = await d.query<{ id: string; slug: string; name: string; session_version: number }>(
      `select id, slug, name, session_version from managers where id = $1 and active`,
      [p.m],
    );
    if (m && m.session_version === p.v) result.manager = { managerId: m.id, slug: m.slug, name: m.name };
  }
  return result;
}

/** Signing out ends every token of that super admin or manager, not just this tab's. */
export async function revoke(request: Request, d: Db): Promise<void> {
  const p = await readToken(request, d);
  if (!p) return;
  if (p.r === 'a') {
    const sessions = await sessionsOf(request, d);
    if (!sessions.admin) return;
    await d.query(
      `insert into settings (key, value) values ('admin_session_version', '2')
       on conflict (key) do update set value = ((coalesce(settings.value, '1'))::int + 1)::text, updated_at = now()`,
    );
  } else if (p.r === 'm' && typeof p.m === 'string' && UUID.test(p.m)) {
    await d.query(`update managers set session_version = session_version + 1 where id = $1 and session_version = $2`, [p.m, p.v ?? -1]);
  }
}
