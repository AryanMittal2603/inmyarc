import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { env } from '../server/env.js';

const KEYS = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'INMYARCSTORAGE_DATABASE_URL',
  'INMYARCSTORAGE_DATABASE_URL_UNPOOLED',
  'INMYARCSTORAGE_POSTGRES_URL',
  'BLOB_READ_WRITE_TOKEN',
  'INMYARCSTORAGE_READ_WRITE_TOKEN',
  'OTHER_READ_WRITE_TOKEN',
];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function clear() {
  for (const k of KEYS) delete process.env[k];
}

describe('storage settings from Vercel', () => {
  test('plain names', () => {
    clear();
    process.env.DATABASE_URL = 'postgresql://u:p@ep-x-pooler.neon.tech/db?sslmode=require';
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_abc_123';
    assert.equal(env.databaseUrl(), process.env.DATABASE_URL);
    assert.equal(env.blobToken(), 'vercel_blob_rw_abc_123');
    assert.equal(env.blobConfigured(), true);
  });

  test('names with a custom prefix', () => {
    clear();
    process.env.INMYARCSTORAGE_DATABASE_URL_UNPOOLED = 'postgresql://u:p@ep-x.neon.tech/db';
    process.env.INMYARCSTORAGE_POSTGRES_URL = 'postgres://u:p@ep-x-pooler.neon.tech/db?b=1';
    process.env.INMYARCSTORAGE_DATABASE_URL = 'postgresql://u:p@ep-x-pooler.neon.tech/db?a=1';
    process.env.OTHER_READ_WRITE_TOKEN = 'not-a-blob-token';
    process.env.INMYARCSTORAGE_READ_WRITE_TOKEN = 'vercel_blob_rw_store_456';
    assert.equal(env.databaseUrl(), 'postgresql://u:p@ep-x-pooler.neon.tech/db?a=1', 'the pooled DATABASE_URL wins');
    assert.equal(env.blobToken(), 'vercel_blob_rw_store_456', 'only real Blob tokens count');
  });

  test('nothing connected', () => {
    clear();
    process.env.OTHER_READ_WRITE_TOKEN = 'nope';
    assert.equal(env.databaseUrl(), '');
    assert.equal(env.blobToken(), '');
    assert.equal(env.blobConfigured(), false);
  });
});
