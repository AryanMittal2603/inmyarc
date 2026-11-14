import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from './env.js';
import { HttpError } from './http.js';

export const PASSCODE_HEADER = 'x-admin-passcode';

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

/** The admin page sends the passcode (URI-encoded) with every request. */
export function isAdmin(request: Request): boolean {
  const raw = request.headers.get(PASSCODE_HEADER);
  if (!raw) return false;
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    // keep the raw header
  }
  return checkPasscode(value);
}

export function requireAdmin(request: Request, message = 'Only the admin can do that. Unlock /rating with the passcode.'): void {
  if (!passcodeConfigured()) {
    throw new HttpError(503, 'The admin passcode is not set up yet. Add ADMIN_PASSCODE to the Vercel project and redeploy.', 'no_passcode');
  }
  if (!isAdmin(request)) throw new HttpError(401, message, 'not_admin');
}
