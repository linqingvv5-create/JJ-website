create table if not exists public.app_documents (
  id text primary key,
  revision bigint not null default 0,
  saved_at text,
  body jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.app_documents enable row level security;
