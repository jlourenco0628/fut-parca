create extension if not exists pgcrypto with schema extensions;

alter table private.fut_parca_store
  add column if not exists revision bigint not null default 0,
  add column if not exists api_secret_hash bytea;

-- SHA-256 de uma chave aleatória de 256 bits. A chave original existe somente
-- nas variáveis secretas da hospedagem; este hash não permite autenticação.
update private.fut_parca_store
set api_secret_hash = decode('f06189419d04cb893984a7802f20c90fc1bb2efc75edcad13f1ffd2650ba2cdc', 'hex')
where id = 'main';

alter table private.fut_parca_store
  alter column api_secret_hash set not null;

create or replace function public.fut_parca_read(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  select jsonb_build_object('data', data, 'revision', revision)
    into result
  from private.fut_parca_store
  where id = 'main'
    and api_secret_hash = extensions.digest(p_secret, 'sha256');

  if result is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return result;
end;
$$;

create or replace function public.fut_parca_compare_and_swap(
  p_secret text,
  p_expected_revision bigint,
  p_next jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  if jsonb_typeof(p_next) <> 'object' then
    raise exception 'invalid payload' using errcode = '22023';
  end if;

  update private.fut_parca_store
  set data = p_next,
      revision = revision + 1,
      updated_at = now()
  where id = 'main'
    and revision = p_expected_revision
    and api_secret_hash = extensions.digest(p_secret, 'sha256');

  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

revoke all on function public.fut_parca_read(text) from public, authenticated;
revoke all on function public.fut_parca_compare_and_swap(text, bigint, jsonb) from public, authenticated;
grant execute on function public.fut_parca_read(text) to anon;
grant execute on function public.fut_parca_compare_and_swap(text, bigint, jsonb) to anon;
