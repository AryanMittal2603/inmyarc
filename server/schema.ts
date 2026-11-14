/**
 * Database schema. Runs automatically (idempotently) the first time the API talks to a
 * database whose schema_version differs from SCHEMA_VERSION.
 */
export const SCHEMA_VERSION = '1';

export const SCHEMA: string[] = [
  `create table if not exists settings (
    key text primary key,
    value text,
    updated_at timestamptz not null default now()
  )`,

  `create table if not exists members (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    title text,
    active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,

  `create table if not exists day_logs (
    id uuid primary key default gen_random_uuid(),
    member_id uuid not null references members (id) on delete cascade,
    log_date date not null,
    attendance text not null check (attendance in ('full_day', 'wfh', 'half_day', 'week_off', 'leave')),
    note text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (member_id, log_date)
  )`,
  `create index if not exists day_logs_log_date_idx on day_logs (log_date)`,

  `create table if not exists entries (
    id uuid primary key default gen_random_uuid(),
    log_date date not null,
    member_id uuid not null references members (id) on delete cascade,
    created_by uuid references members (id) on delete set null,
    title text not null,
    details text,
    status text not null default 'not_done' check (status in ('done', 'not_done', 'rework')),
    minutes integer check (minutes is null or (minutes >= 0 and minutes <= 1440)),
    remarks text,
    attachment_path text,
    attachment_name text,
    attachment_type text,
    attachment_size integer,
    status_by uuid references members (id) on delete set null,
    status_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  `create index if not exists entries_log_date_idx on entries (log_date, created_at)`,
  `create index if not exists entries_member_date_idx on entries (member_id, log_date)`,

  `create table if not exists day_marks (
    member_id uuid not null references members (id) on delete cascade,
    log_date date not null,
    category text not null check (category in ('extraordinary', 'over_performed', 'upto_mark', 'can_be_better', 'not_upto_mark')),
    overtime boolean not null default false,
    holiday boolean not null default false,
    hero boolean not null default false,
    marked_at timestamptz not null default now(),
    primary key (member_id, log_date)
  )`,
  `create index if not exists day_marks_log_date_idx on day_marks (log_date)`,
];
