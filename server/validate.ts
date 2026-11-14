import { HttpError } from './http.js';
import { isDate } from './time.js';

export const ATTENDANCE = ['full_day', 'wfh', 'half_day', 'week_off', 'leave'] as const;
export const STATUSES = ['done', 'not_done', 'rework'] as const;
export const CATEGORIES = ['extraordinary', 'over_performed', 'upto_mark', 'can_be_better', 'not_upto_mark'] as const;

export type Attendance = (typeof ATTENDANCE)[number];
export type Status = (typeof STATUSES)[number];
export type Category = (typeof CATEGORIES)[number];

export const LIMITS = {
  title: 180,
  details: 400,
  brief: 600,
  note: 140,
  remarks: 500,
  fileName: 180,
  fileBytes: 10 * 1024 * 1024,
  minutes: 1440,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Pathnames handed out for uploads: task-files/YYYY-MM/<uuid><.ext> */
export const ATTACHMENT_PATH = /^task-files\/\d{4}-\d{2}\/[0-9a-z-]{8,64}(\.[a-z0-9]{1,11})?$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** A uuid, or a 400 with `message` (shown to the user as-is). */
export function uuid(value: unknown, message: string): string {
  if (!isUuid(value)) throw new HttpError(400, message);
  return value.toLowerCase();
}

export function optionalUuid(value: unknown): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
}

export function date(value: unknown, what = 'Day'): string {
  if (!isDate(value)) throw new HttpError(400, `${what} is not a valid date.`);
  return value;
}

export function oneOf<T extends string>(value: unknown, options: readonly T[], what: string): T {
  if (typeof value !== 'string' || !options.includes(value as T)) throw new HttpError(400, `${what} is not one of the allowed values.`);
  return value as T;
}

/** Trimmed text or null when empty. Rejects anything over the limit. */
export function text(value: unknown, limit: number, what: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new HttpError(400, `${what} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > limit) throw new HttpError(400, `${what} is too long (${limit} characters at most).`);
  return trimmed || null;
}

export function title(value: unknown, missing = 'A task needs a title.'): string {
  const t = text(value, LIMITS.title, 'The task');
  if (!t) throw new HttpError(400, missing);
  return t;
}

/** Remarks are trimmed and cut at 500 characters, like the original. */
export function remarks(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new HttpError(400, 'Remarks must be text.');
  return value.trim().slice(0, LIMITS.remarks) || null;
}

export function minutes(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new HttpError(400, 'Time taken is not a number.');
  return Math.min(Math.max(Math.round(n), 0), LIMITS.minutes);
}

export interface AttachmentInput {
  path: string;
  name: string;
  type: string | null;
  size: number;
}

/** undefined = leave as is, null = remove, object = set. */
export function attachment(value: unknown): AttachmentInput | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'object') throw new HttpError(400, 'The attachment is not valid.');
  const a = value as Record<string, unknown>;
  if (typeof a.path !== 'string' || !ATTACHMENT_PATH.test(a.path)) throw new HttpError(400, 'The attachment is not valid.');
  if (typeof a.name !== 'string' || !a.name.trim()) throw new HttpError(400, 'The attachment has no name.');
  const size = Number(a.size);
  if (!Number.isFinite(size) || size <= 0) throw new HttpError(400, `"${a.name}" is empty.`);
  if (size > LIMITS.fileBytes) throw new HttpError(400, `"${a.name}" is too big. The limit is 10 MB per file.`);
  return {
    path: a.path,
    name: a.name.trim().slice(0, LIMITS.fileName),
    type: typeof a.type === 'string' && a.type ? a.type.slice(0, 160) : null,
    size: Math.round(size),
  };
}

export function bool(value: unknown): boolean {
  return value === true;
}

/** URL names for teams: /task/<slug>, /rating/<slug>. */
export const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function isSlug(value: unknown): value is string {
  return typeof value === 'string' && SLUG.test(value);
}

export function slug(value: unknown): string {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!SLUG.test(v)) throw new HttpError(400, 'Use 1–40 lowercase letters, numbers or hyphens for the link name, like "manager1".');
  return v;
}

export function personName(value: unknown, what = 'The name'): string {
  const v = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!v) throw new HttpError(400, `${what} is missing.`);
  if (v.length > 60) throw new HttpError(400, `${what} is too long (60 characters at most).`);
  return v;
}

export function password(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8) throw new HttpError(400, 'Use a password of at least 8 characters.');
  if (value.length > 200) throw new HttpError(400, 'That password is too long.');
  return value;
}
