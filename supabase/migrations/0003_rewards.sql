-- HouseHero - part 3 of 3. Run after 0001_init.sql and 0002_tasks.sql. Safe
-- to run again on its own too.

create table if not exists public.rewards (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces(id) on delete cascade,
  title       text not null check (length(trim(title)) between 1 and 80),
  description text,
  cost        smallint not null check (cost between 1 and 100000),
  created_by  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index if not exists rewards_space_idx on public.rewards(space_id);

-- A redemption request. Snapshots the reward's title/cost at request time so
-- editing or deleting the reward later never rewrites history, and so the
-- cost that gets deducted on approval can never drift from what was shown to
-- the person who requested it.
create table if not exists public.reward_redemptions (
  id            uuid primary key default gen_random_uuid(),
  space_id      uuid not null references public.spaces(id) on delete cascade,
  reward_id     uuid references public.rewards(id) on delete set null,
  reward_title  text not null,
  cost          smallint not null,
  requested_by  uuid not null references auth.users(id) on delete cascade,
  approved_by   uuid references auth.users(id) on delete set null,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_at  timestamptz not null default now(),
  decided_at    timestamptz
);

create index if not exists reward_redemptions_space_idx on public.reward_redemptions(space_id, status);

-- Re-running this file against a database created before 'cancelled' existed
-- needs the old check constraint widened, since the column already exists.
alter table public.reward_redemptions drop constraint if exists reward_redemptions_status_check;
alter table public.reward_redemptions add constraint reward_redemptions_status_check
  check (status in ('pending', 'approved', 'rejected', 'cancelled'));

-- RLS --

do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in ('rewards', 'reward_redemptions')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

alter table public.rewards            enable row level security;
alter table public.reward_redemptions enable row level security;

create policy rewards_select on public.rewards for select
  using (public.is_member(space_id));
create policy rewards_insert on public.rewards for insert
  with check (public.is_member(space_id) and created_by = auth.uid());
create policy rewards_update on public.rewards for update
  using (public.is_member(space_id)) with check (public.is_member(space_id));
create policy rewards_delete on public.rewards for delete
  using (public.is_member(space_id));

create policy reward_redemptions_select on public.reward_redemptions for select
  using (public.is_member(space_id));
-- Deliberately no insert/update/delete policy. A client-issued insert could
-- lie about reward_title/cost, and a client-issued update could approve a
-- redemption without ever deducting points - both would break the "the other
-- person must approve, and only approval moves points" rule. The three RPCs
-- below are the only way to touch this table, and they run as the table
-- owner (SECURITY DEFINER), which bypasses RLS entirely.

-- RPCs --

-- Snapshots the reward's current title/cost so later edits to the reward
-- never rewrite a pending or historical request.
create or replace function public.request_redemption(p_reward uuid)
returns public.reward_redemptions language plpgsql security definer set search_path = public as $$
declare
  target public.rewards;
  result public.reward_redemptions;
begin
  select * into target from public.rewards where id = p_reward;
  if target.id is null then
    raise exception 'no_such_reward' using errcode = 'P0002';
  end if;
  if not public.is_member(target.space_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  insert into public.reward_redemptions (space_id, reward_id, reward_title, cost, requested_by)
  values (target.space_id, target.id, target.title, target.cost, auth.uid())
  returning * into result;

  return result;
end;
$$;

-- Only someone other than the requester can approve - "the other spouse" -
-- and only approval ever deducts points, from spendable_points alone.
create or replace function public.approve_redemption(p_redemption uuid)
returns public.reward_redemptions language plpgsql security definer set search_path = public as $$
declare
  target  public.reward_redemptions;
  balance integer;
  result  public.reward_redemptions;
begin
  select * into target from public.reward_redemptions where id = p_redemption;
  if target.id is null then
    raise exception 'no_such_redemption' using errcode = 'P0002';
  end if;
  if not public.is_member(target.space_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if target.status <> 'pending' then
    raise exception 'not_pending' using errcode = 'P0002';
  end if;
  if target.requested_by = auth.uid() then
    raise exception 'cannot_approve_own_request' using errcode = '42501';
  end if;

  select spendable_points into balance from public.profiles where id = target.requested_by;
  if balance < target.cost then
    raise exception 'insufficient_points' using errcode = 'P0001';
  end if;

  update public.profiles set spendable_points = spendable_points - target.cost
  where id = target.requested_by;

  update public.reward_redemptions
  set status = 'approved', approved_by = auth.uid(), decided_at = now()
  where id = p_redemption
  returning * into result;

  return result;
end;
$$;

create or replace function public.reject_redemption(p_redemption uuid)
returns public.reward_redemptions language plpgsql security definer set search_path = public as $$
declare
  target public.reward_redemptions;
  result public.reward_redemptions;
begin
  select * into target from public.reward_redemptions where id = p_redemption;
  if target.id is null then
    raise exception 'no_such_redemption' using errcode = 'P0002';
  end if;
  if not public.is_member(target.space_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if target.status <> 'pending' then
    raise exception 'not_pending' using errcode = 'P0002';
  end if;
  if target.requested_by = auth.uid() then
    raise exception 'cannot_reject_own_request' using errcode = '42501';
  end if;

  update public.reward_redemptions
  set status = 'rejected', approved_by = auth.uid(), decided_at = now()
  where id = p_redemption
  returning * into result;

  return result;
end;
$$;

-- The requester can withdraw their own still-pending request - the mirror of
-- reject_redemption, which only the other person may call.
create or replace function public.cancel_redemption(p_redemption uuid)
returns public.reward_redemptions language plpgsql security definer set search_path = public as $$
declare
  target public.reward_redemptions;
  result public.reward_redemptions;
begin
  select * into target from public.reward_redemptions where id = p_redemption;
  if target.id is null then
    raise exception 'no_such_redemption' using errcode = 'P0002';
  end if;
  if target.requested_by <> auth.uid() then
    raise exception 'not_your_request' using errcode = '42501';
  end if;
  if target.status <> 'pending' then
    raise exception 'not_pending' using errcode = 'P0002';
  end if;

  update public.reward_redemptions
  set status = 'cancelled', decided_at = now()
  where id = p_redemption
  returning * into result;

  return result;
end;
$$;

-- Live updates, so an approval or rejection shows up for both people without
-- a manual refresh.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reward_redemptions'
  ) then
    alter publication supabase_realtime add table public.reward_redemptions;
  end if;
end $$;

do $$
begin
  raise notice '✅ HouseHero fully installed. The reminder job runs every 15 minutes.';
end $$;
