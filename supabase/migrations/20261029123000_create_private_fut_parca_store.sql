create schema if not exists private;

create table if not exists private.fut_parca_store (
  id text primary key constraint fut_parca_singleton check (id = 'main'),
  data jsonb not null,
  updated_at timestamptz not null default now()
);

revoke all on schema private from public, anon, authenticated;
revoke all on table private.fut_parca_store from public, anon, authenticated;
alter table private.fut_parca_store enable row level security;

insert into private.fut_parca_store (id, data)
values (
  'main',
  '{"version":2,"users":[],"groups":[],"sessions":[],"joinRequests":[]}'::jsonb
)
on conflict (id) do nothing;
