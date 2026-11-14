/**
 * Settings from the Vercel project. Storage connected with a custom prefix gets prefixed
 * names (INMYARCSTORAGE_DATABASE_URL instead of DATABASE_URL), so both spellings work.
 */
function lookup(exact: string[], suffixes: string[], valid: (value: string) => boolean): string {
  for (const name of exact) {
    const value = process.env[name]?.trim();
    if (value && valid(value)) return value;
  }
  const names = Object.keys(process.env).sort();
  for (const suffix of suffixes) {
    for (const name of names) {
      if (!name.endsWith(suffix)) continue;
      const value = process.env[name]?.trim();
      if (value && valid(value)) return value;
    }
  }
  return '';
}

const isPostgresUrl = (value: string) => /^postgres(?:ql)?:\/\//i.test(value);
const isBlobToken = (value: string) => value.startsWith('vercel_blob_rw_');

export const env = {
  /** Neon's pooled URL: DATABASE_URL, POSTGRES_URL, or the same with a prefix. */
  databaseUrl: (): string => lookup(['DATABASE_URL', 'POSTGRES_URL'], ['_DATABASE_URL', '_POSTGRES_URL'], isPostgresUrl),
  /** The private Blob store's read-write token: BLOB_READ_WRITE_TOKEN, or <PREFIX>_READ_WRITE_TOKEN. */
  blobToken: (): string => lookup(['BLOB_READ_WRITE_TOKEN'], ['_READ_WRITE_TOKEN'], isBlobToken),
  /** The super admin's password for /admin. */
  adminPasscode: (): string => process.env.ADMIN_PASSCODE || '',
  /** Optional: signs session cookies. Without it a random secret is kept in the settings table. */
  sessionSecret: (): string => process.env.SESSION_SECRET || '',
  editableFrom: (): string => (process.env.EDITABLE_FROM || '').trim(),
  blobConfigured: (): boolean => env.blobToken() !== '',
};
