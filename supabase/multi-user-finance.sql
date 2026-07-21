-- Linqing Finance: authenticated households, private user data, RLS and realtime.
-- Run this entire file once in the Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  invite_code text not null unique default upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10)),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  display_name text not null default '',
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.household_finance_state (
  household_id uuid primary key references public.households(id) on delete cascade,
  revision bigint not null default 0,
  body jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.personal_finance_state (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null default 0,
  body jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.household_investment_state (
  household_id uuid primary key references public.households(id) on delete cascade,
  revision bigint not null default 0,
  body jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create or replace function public.is_household_member(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.household_members
    where household_id = target_household_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_household_admin(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.household_members
    where household_id = target_household_id
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.create_household(household_name text, member_display_name text)
returns table (household_id uuid, invite_code text, name text, role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  created_household public.households;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(household_name), '') is null then raise exception 'Household name is required'; end if;

  insert into public.households (name, created_by)
  values (trim(household_name), auth.uid())
  returning * into created_household;

  insert into public.household_members (household_id, user_id, role, display_name)
  values (created_household.id, auth.uid(), 'owner', coalesce(nullif(trim(member_display_name), ''), '家庭创建者'));

  insert into public.household_finance_state (household_id, revision, body, updated_by)
  values (created_household.id, 0, '{}'::jsonb, auth.uid());

  return query select created_household.id, created_household.invite_code, created_household.name, 'owner'::text;
end;
$$;

create or replace function public.join_household(join_code text, member_display_name text)
returns table (household_id uuid, invite_code text, name text, role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.households;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into target from public.households where invite_code = upper(trim(join_code));
  if target.id is null then raise exception 'Invalid household invite code'; end if;

  insert into public.household_members (household_id, user_id, role, display_name)
  values (target.id, auth.uid(), 'member', coalesce(nullif(trim(member_display_name), ''), '家庭成员'))
  on conflict (household_id, user_id) do update set display_name = excluded.display_name;

  return query select target.id, target.invite_code, target.name, 'member'::text;
end;
$$;

create or replace function public.save_household_finance_state(
  target_household_id uuid,
  expected_revision bigint,
  next_body jsonb
)
returns table (revision bigint, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_revision bigint;
  saved_at timestamptz := now();
begin
  if not public.is_household_member(target_household_id) then raise exception 'Household access denied'; end if;
  select s.revision into current_revision
  from public.household_finance_state s
  where s.household_id = target_household_id
  for update;

  if current_revision is null then
    if expected_revision <> 0 then raise exception 'Finance state revision conflict'; end if;
    insert into public.household_finance_state (household_id, revision, body, updated_by, updated_at)
    values (target_household_id, 1, coalesce(next_body, '{}'::jsonb), auth.uid(), saved_at);
    return query select 1::bigint, saved_at;
  end if;

  if current_revision <> expected_revision then raise exception 'Finance state revision conflict'; end if;
  update public.household_finance_state
  set revision = current_revision + 1, body = coalesce(next_body, '{}'::jsonb), updated_by = auth.uid(), updated_at = saved_at
  where household_id = target_household_id;
  return query select current_revision + 1, saved_at;
end;
$$;

create or replace function public.save_personal_finance_state(
  target_household_id uuid,
  expected_revision bigint,
  next_body jsonb
)
returns table (revision bigint, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_revision bigint;
  saved_at timestamptz := now();
begin
  if not public.is_household_member(target_household_id) then raise exception 'Household access denied'; end if;
  select s.revision into current_revision
  from public.personal_finance_state s
  where s.household_id = target_household_id and s.user_id = auth.uid()
  for update;

  if current_revision is null then
    if expected_revision <> 0 then raise exception 'Personal state revision conflict'; end if;
    insert into public.personal_finance_state (household_id, user_id, revision, body, updated_at)
    values (target_household_id, auth.uid(), 1, coalesce(next_body, '{}'::jsonb), saved_at);
    return query select 1::bigint, saved_at;
  end if;

  if current_revision <> expected_revision then raise exception 'Personal state revision conflict'; end if;
  update public.personal_finance_state
  set revision = current_revision + 1, body = coalesce(next_body, '{}'::jsonb), updated_at = saved_at
  where household_id = target_household_id and user_id = auth.uid();
  return query select current_revision + 1, saved_at;
end;
$$;

create or replace function public.save_household_investment_state(
  target_household_id uuid,
  expected_revision bigint,
  next_body jsonb
)
returns table (revision bigint, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_revision bigint;
  saved_at timestamptz := now();
begin
  if not public.is_household_member(target_household_id) then raise exception 'Household access denied'; end if;
  select s.revision into current_revision from public.household_investment_state s
  where s.household_id = target_household_id for update;
  if current_revision is null then
    if expected_revision <> 0 then raise exception 'Investment state revision conflict'; end if;
    insert into public.household_investment_state (household_id, revision, body, updated_by, updated_at)
    values (target_household_id, 1, coalesce(next_body, '{}'::jsonb), auth.uid(), saved_at);
    return query select 1::bigint, saved_at;
  end if;
  if current_revision <> expected_revision then raise exception 'Investment state revision conflict'; end if;
  update public.household_investment_state set revision = current_revision + 1,
    body = coalesce(next_body, '{}'::jsonb), updated_by = auth.uid(), updated_at = saved_at
  where household_id = target_household_id;
  return query select current_revision + 1, saved_at;
end;
$$;

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_finance_state enable row level security;
alter table public.personal_finance_state enable row level security;
alter table public.household_investment_state enable row level security;

drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles for select to authenticated using (user_id = auth.uid());
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists households_member_select on public.households;
create policy households_member_select on public.households for select to authenticated using (public.is_household_member(id));
drop policy if exists households_admin_update on public.households;
create policy households_admin_update on public.households for update to authenticated using (public.is_household_admin(id)) with check (public.is_household_admin(id));

drop policy if exists household_members_member_select on public.household_members;
create policy household_members_member_select on public.household_members for select to authenticated using (public.is_household_member(household_id));
drop policy if exists household_members_self_update on public.household_members;
create policy household_members_self_update on public.household_members for update to authenticated using (user_id = auth.uid() or public.is_household_admin(household_id)) with check (user_id = auth.uid() or public.is_household_admin(household_id));

drop policy if exists household_state_member_select on public.household_finance_state;
create policy household_state_member_select on public.household_finance_state for select to authenticated using (public.is_household_member(household_id));

drop policy if exists personal_state_self_select on public.personal_finance_state;
create policy personal_state_self_select on public.personal_finance_state for select to authenticated using (user_id = auth.uid() and public.is_household_member(household_id));

drop policy if exists investment_state_member_select on public.household_investment_state;
create policy investment_state_member_select on public.household_investment_state for select to authenticated using (public.is_household_member(household_id));

revoke all on public.profiles, public.households, public.household_members, public.household_finance_state, public.personal_finance_state, public.household_investment_state from anon;
grant select, update on public.profiles to authenticated;
grant select on public.households to authenticated;
grant select on public.household_members to authenticated;
grant select on public.household_finance_state to authenticated;
grant select on public.personal_finance_state to authenticated;
grant select on public.household_investment_state to authenticated;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.join_household(text, text) to authenticated;
grant execute on function public.save_household_finance_state(uuid, bigint, jsonb) to authenticated;
grant execute on function public.save_personal_finance_state(uuid, bigint, jsonb) to authenticated;
grant execute on function public.save_household_investment_state(uuid, bigint, jsonb) to authenticated;
revoke execute on function public.create_household(text, text) from anon;
revoke execute on function public.join_household(text, text) from anon;
revoke execute on function public.save_household_finance_state(uuid, bigint, jsonb) from anon;
revoke execute on function public.save_personal_finance_state(uuid, bigint, jsonb) from anon;
revoke execute on function public.save_household_investment_state(uuid, bigint, jsonb) from anon;
revoke execute on function public.create_household(text, text) from public;
revoke execute on function public.join_household(text, text) from public;
revoke execute on function public.save_household_finance_state(uuid, bigint, jsonb) from public;
revoke execute on function public.save_personal_finance_state(uuid, bigint, jsonb) from public;
revoke execute on function public.save_household_investment_state(uuid, bigint, jsonb) from public;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'household_finance_state') then
    alter publication supabase_realtime add table public.household_finance_state;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'personal_finance_state') then
    alter publication supabase_realtime add table public.personal_finance_state;
  end if;
end $$;
