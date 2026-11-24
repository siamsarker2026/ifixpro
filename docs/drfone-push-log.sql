-- Run once in the MASTER Supabase project (the one that holds device_master):
-- Supabase dashboard -> SQL Editor -> paste -> Run.
--
-- One row per call to /api/drfone/push, so the "Dr.Fone Pushes" page can show
-- who sent what and when. Only the server (service role) reads and writes it.

create table if not exists public.drfone_push_log (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  status        int  not null,              -- HTTP status we answered with
  dry_run       boolean not null default false,
  received      int  not null default 0,
  inserted      int  not null default 0,
  updated       int  not null default 0,
  skipped_older int  not null default 0,
  rejected      int  not null default 0,
  imeis         text[] not null default '{}', -- devices actually written
  error         text,
  source_ip     text
);

create index if not exists drfone_push_log_created_at_idx
  on public.drfone_push_log (created_at desc);

-- Row-level security on with no policies: the anon key sees nothing.
alter table public.drfone_push_log enable row level security;
