import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { Db } from './db.js';
import { env } from './env.js';

/*
 * Two kinds of sign-in, each in its own HttpOnly cookie:
 *   iv_admin   — the super admin (password = ADMIN_PASSCODE), 12 hours
 *   iv_manager — one manager (password set by the super admin, stored hashed), 7 days
 * Cookies are signed with HMAC-SHA256. Changing ADMIN_PASSCODE signs every super admin out;
 * resetting or deactivating a manager signs that manager out (session_version).
 */

const ADMIN_COOKIE = 'iv_admin';
const MANAGER_COOKIE = 'iv_manager';
const ADMIN_TTL = 12 * 60 * 60;
const MANAGER_TTL = 7 * 24 * 60 * 60;

export interface ManagerSession {
  managerId: string;
  slug: string;
  name: string;
}

export interface Sessions {
  admin: boolean;
  manager: ManagerSession | null;
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

/* ───────── signed cookies ───────── */

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

function readCookies(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function cookie(request: Request, name: string, value: string, maxAge: number): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

const now = () => Math.floor(Date.now() / 1000);

function adminFingerprint(key: string): string {
  return createHmac('sha256', key).update(`admin:${env.adminPasscode()}`).digest('base64url').slice(0, 22);
}

export async function adminCookie(request: Request, d: Db): Promise<string> {
  const key = await secret(d);
  return cookie(request, ADMIN_COOKIE, sign(key, { r: 'a', f: adminFingerprint(key), e: now() + ADMIN_TTL }), ADMIN_TTL);
}

export async function managerCookie(request: Request, d: Db, manager: { id: string; session_version: number }): Promise<string> {
  const key = await secret(d);
  const token = sign(key, { r: 'm', m: manager.id, v: manager.session_version, e: now() + MANAGER_TTL });
  return cookie(request, MANAGER_COOKIE, token, MANAGER_TTL);
}

export function clearCookie(request: Request, which: 'admin' | 'manager'): string {
  return cookie(request, which === 'admin' ? ADMIN_COOKIE : MANAGER_COOKIE, '', 0);
}

/** Who is signed in on this request (both can be true in one browser). */
export async function sessionsOf(request: Request, d: Db): Promise<Sessions> {
  const jar = readCookies(request);
  const result: Sessions = { admin: false, manager: null };
  if (!jar[ADMIN_COOKIE] && !jar[MANAGER_COOKIE]) return result;
  const key = await secret(d);

  if (jar[ADMIN_COOKIE] && passcodeConfigured()) {
    const p = unsign<{ r: string; f: string; e: number }>(key, jar[ADMIN_COOKIE]);
    result.admin = !!p && p.r === 'a' && p.e > now() && p.f === adminFingerprint(key);
  }
  if (jar[MANAGER_COOKIE]) {
    const p = unsign<{ r: string; m: string; v: number; e: number }>(key, jar[MANAGER_COOKIE]);
    if (p && p.r === 'm' && p.e > now() && typeof p.m === 'string') {
      const [m] = await d.query<{ id: string; slug: string; name: string; session_version: number }>(
        `select id, slug, name, session_version from managers where id = $1 and active`,
        [p.m],
      );
      if (m && m.session_version === p.v) result.manager = { managerId: m.id, slug: m.slug, name: m.name };
    }
  }
  return result;
}
