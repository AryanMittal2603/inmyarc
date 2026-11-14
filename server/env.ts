export const env = {
  databaseUrl: (): string => process.env.DATABASE_URL || process.env.POSTGRES_URL || '',
  adminPasscode: (): string => process.env.ADMIN_PASSCODE || '',
  editableFrom: (): string => (process.env.EDITABLE_FROM || '').trim(),
  blobConfigured: (): boolean => Boolean(process.env.BLOB_READ_WRITE_TOKEN),
};
