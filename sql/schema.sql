-- ============================================================
-- ShiftTracker — Supabase schema
-- Safe to run more than once (fresh install or upgrading an
-- existing project): every step uses IF NOT EXISTS / OR REPLACE.
-- Run in Supabase → SQL Editor → New query.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. profiles
--    One row per auth.users row. Holds name + role.
--    role: 'employee' (tracks their own shifts) or
--          'manager'  (can view every employee's shifts/status)
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text,
  last_name text,
  email text,
  role text not null default 'employee',
  created_at timestamptz not null default now()
);

-- Upgrade path for projects created before roles/first+last name existed.
alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;
alter table public.profiles add column if not exists role text not null default 'employee';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_role_check'
  ) then
    alter table public.profiles
      add constraint profiles_role_check check (role in ('employee', 'manager'));
  end if;
end $$;

-- Backfill first_name from the old full_name column, if it exists.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'full_name'
  ) then
    update public.profiles
      set first_name = coalesce(first_name, split_part(full_name, ' ', 1))
      where first_name is null;
  end if;
end $$;

alter table public.profiles enable row level security;

drop policy if exists "Profiles are viewable by their owner" on public.profiles;
create policy "Profiles are viewable by their owner"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Profiles are editable by their owner" on public.profiles;
create policy "Profiles are editable by their owner"
  on public.profiles for update
  using (auth.uid() = id);

drop policy if exists "Profiles are insertable by their owner" on public.profiles;
create policy "Profiles are insertable by their owner"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Automatically create a profile row whenever a new user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, first_name, last_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'first_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    new.email,
    case
      when new.raw_user_meta_data ->> 'role' = 'manager' then 'manager'
      else 'employee'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Helper: is the currently-authenticated user a manager?
-- security definer so it can read profiles without recursing into
-- the profiles RLS policies above.
create or replace function public.is_manager()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'manager'
  );
$$;

-- Managers can see every profile (needed for the team roster).
drop policy if exists "Managers can view all profiles" on public.profiles;
create policy "Managers can view all profiles"
  on public.profiles for select
  using (public.is_manager());

-- ------------------------------------------------------------
-- 2. shifts
--    One row per shift. status moves working -> on_break -> working -> ended.
--    Location is the most recently reported lat/lng for the shift.
-- ------------------------------------------------------------
create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'working'
    check (status in ('working', 'on_break', 'ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  break_started_at timestamptz,
  total_break_seconds integer not null default 0,
  latitude double precision,
  longitude double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shifts_user_id_idx on public.shifts (user_id);
create index if not exists shifts_user_status_idx on public.shifts (user_id, status);
create index if not exists shifts_started_at_idx on public.shifts (started_at);

alter table public.shifts enable row level security;

drop policy if exists "Shifts are viewable by their owner" on public.shifts;
create policy "Shifts are viewable by their owner"
  on public.shifts for select
  using (auth.uid() = user_id);

drop policy if exists "Shifts are insertable by their owner" on public.shifts;
create policy "Shifts are insertable by their owner"
  on public.shifts for insert
  with check (auth.uid() = user_id);

drop policy if exists "Shifts are updatable by their owner" on public.shifts;
create policy "Shifts are updatable by their owner"
  on public.shifts for update
  using (auth.uid() = user_id);

drop policy if exists "Shifts are deletable by their owner" on public.shifts;
create policy "Shifts are deletable by their owner"
  on public.shifts for delete
  using (auth.uid() = user_id);

-- Managers can see every employee's shifts (read-only).
drop policy if exists "Managers can view all shifts" on public.shifts;
create policy "Managers can view all shifts"
  on public.shifts for select
  using (public.is_manager());

-- keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists shifts_touch_updated_at on public.shifts;
create trigger shifts_touch_updated_at
  before update on public.shifts
  for each row execute procedure public.touch_updated_at();

-- ------------------------------------------------------------
-- 3. Helper view: completed shifts with worked seconds
--    worked_seconds = (ended_at - started_at) - total_break_seconds
-- ------------------------------------------------------------
create or replace view public.shift_summaries as
select
  id,
  user_id,
  started_at,
  ended_at,
  total_break_seconds,
  greatest(
    extract(epoch from (ended_at - started_at))::integer - total_break_seconds,
    0
  ) as worked_seconds
from public.shifts
where ended_at is not null;

-- Views inherit RLS from underlying tables only when created with
-- security_invoker; make that explicit so it respects the shifts
-- policies above (own rows, or every row for managers).
alter view public.shift_summaries set (security_invoker = true);

-- ------------------------------------------------------------
-- 4. Convenience view for the manager dashboard: every employee's
--    profile plus their most recent shift, in one row.
-- ------------------------------------------------------------
create or replace view public.employee_status as
select distinct on (p.id)
  p.id as user_id,
  p.first_name,
  p.last_name,
  p.email,
  p.role,
  s.id as shift_id,
  s.status as shift_status,
  s.started_at,
  s.ended_at,
  s.break_started_at,
  s.total_break_seconds,
  s.latitude,
  s.longitude
from public.profiles p
left join public.shifts s on s.user_id = p.id
order by p.id, s.started_at desc nulls last;

alter view public.employee_status set (security_invoker = true);

-- ------------------------------------------------------------
-- Done. Also enable Email auth in
--   Supabase Dashboard → Authentication → Providers → Email
-- (it's on by default).
--
-- To promote an existing user to manager, run:
--   update public.profiles set role = 'manager' where email = 'someone@example.com';
-- ------------------------------------------------------------
