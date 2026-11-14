export const env = {
  databaseUrl: (): string => process.env.DATABASE_URL || process.env.POSTGRES_URL || '',
  /** The super admin's password for /admin. */
  adminPasscode: (): string => process.env.ADMIN_PASSCODE || '',
  /** Optional: signs session cookies. Without it a random secret is kept in the settings table. */
  sessionSecret: (): string => process.env.SESSION_SECRET || '',
  editableFrom: (): string => (process.env.EDITABLE_FROM || '').trim(),
  blobConfigured: (): boolean => Boolean(process.env.BLOB_READ_WRITE_TOKEN),
};
