-- HouseHero - part 1 of 3. Run this, then 0002_tasks.sql, then
-- 0003_rewards.sql, in that order. Safe to run all three again later.

-- ⬇️  The two values you need to fill in  ⬇️

create schema if not exists private_setup;
create or replace function private_setup.values()
returns table (project_ref text, vapid_private_key text, contact_email text)
language sql immutable set search_path = '' as $$
  select
    -- The project ref: the part before supabase.co in the project URL.
    -- From https://abcdefghijklmnop.supabase.co, write abcdefghijklmnop
    'PASTE_PROJECT_REF_HERE',

    -- The private notification key. You received it together with the code.
    'PASTE_VAPID_PRIVATE_KEY_HERE',

    -- Contact email for the push service. Never shown in the app.
    'househero@example.com';
$$;

--  ⬆️  Nothing below this line needs editing  ⬆️

create extension if not exists "pgcrypto";

-- profiles --

create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  email            text,
  display_name     text,
  avatar_url       text,
  timezone         text not null default 'Asia/Jerusalem',
  -- Interface language. Nullable so browser detection on first sign-in is not
  -- overwritten by a server default.
  language         text check (language in ('he', 'en')),
  -- Never decreases - a pure stats/achievement counter.
  lifetime_points  integer not null default 0 check (lifetime_points >= 0),
  -- Decreases only when a reward redemption is approved.
  spendable_points integer not null default 0 check (spendable_points >= 0),
  created_at       timestamptz not null default now()
);

-- Every signed-in user gets a profile row, so the app never meets a
-- "signed in but no profile" state.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(coalesce(new.email, ''), '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- The points columns must never be set by an ordinary client update - only by
-- the SECURITY DEFINER functions (complete_task, undo_last_completion,
-- approve_redemption in the next two files), which run with the table
-- owner's privileges and are therefore unaffected by this column-level
-- restriction. Enforced at the grant level, not by an RLS policy, because
-- RLS is row-scoped and cannot by itself say "this column of this row is
-- off limits".
revoke update on public.profiles from authenticated, anon;
grant update (display_name, avatar_url, timezone, language) on public.profiles to authenticated;

-- spaces --

create table if not exists public.spaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 60),
  invite_code text not null unique,
  created_by  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.space_members (
  space_id  uuid not null references public.spaces(id) on delete cascade,
  -- profiles, not auth.users, so PostgREST can embed the names in one query.
  user_id   uuid not null references public.profiles(id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

create index if not exists space_members_user_idx on public.space_members(user_id);

-- pushing --

create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_sent_at  timestamptz,
  failure_count smallint not null default 0
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

-- helpers --

-- SECURITY DEFINER so an RLS policy can ask "is this person a member?"
-- without re-triggering itself.
create or replace function public.is_member(p_space uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.space_members
    where space_id = p_space and user_id = auth.uid()
  );
$$;

create or replace function public.is_owner(p_space uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.space_members
    where space_id = p_space and user_id = auth.uid() and role = 'owner'
  );
$$;

create or replace function public.shares_space_with(p_user uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from public.space_members mine
    join public.space_members theirs on theirs.space_id = mine.space_id
    where mine.user_id = auth.uid() and theirs.user_id = p_user
  );
$$;

-- No 0/O or 1/I/L, so a code read aloud or typed from a screenshot works.
create or replace function public.generate_invite_code()
returns text language plpgsql set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  candidate text;
begin
  loop
    candidate := '';
    for _ in 1..6 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.spaces where invite_code = candidate);
  end loop;
  return candidate;
end;
$$;

-- Postgres grants EXECUTE on every new function to PUBLIC by default, which
-- would let an unauthenticated caller invoke these as bare RPCs
-- (/rest/v1/rpc/is_member, etc.) even though they exist only to be called
-- from inside RLS policies and the new-user trigger. authenticated keeps
-- EXECUTE on the three membership checks because policies evaluated for a
-- signed-in user need to call them; handle_new_user needs no grant back at
-- all - only the trigger ever invokes it.
revoke execute on function public.is_member(uuid) from public;
revoke execute on function public.is_owner(uuid) from public;
revoke execute on function public.shares_space_with(uuid) from public;
revoke execute on function public.handle_new_user() from public;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.is_owner(uuid) to authenticated;
grant execute on function public.shares_space_with(uuid) to authenticated;

-- RLS --

-- Cleared first so this file re-runs on its own; recreated below. Scoped to
-- this file's own tables so re-running it never touches the policies the
-- other two migration files create.
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'spaces', 'space_members', 'push_subscriptions')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

alter table public.profiles           enable row level security;
alter table public.spaces             enable row level security;
alter table public.space_members      enable row level security;
alter table public.push_subscriptions enable row level security;

-- Yourself, plus anyone you share a space with, so the app can say
-- "completed by Dana" rather than showing an id.
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.shares_space_with(id));
create policy profiles_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

create policy spaces_select on public.spaces for select
  using (public.is_member(id));
-- No insert policy: create_space() also makes the creator an owner.
create policy spaces_update on public.spaces for update
  using (public.is_owner(id)) with check (public.is_owner(id));
create policy spaces_delete on public.spaces for delete
  using (public.is_owner(id));

create policy space_members_select on public.space_members for select
  using (public.is_member(space_id));
-- Also no insert policy: membership comes only from create_space() and
-- join_space_by_code(). "user_id = auth.uid()" would let anyone who learned
-- a space id join it. Delete: yourself always, others if owner.
create policy space_members_delete on public.space_members for delete
  using (user_id = auth.uid() or public.is_owner(space_id));

create policy push_select on public.push_subscriptions for select using (user_id = auth.uid());
create policy push_insert on public.push_subscriptions for insert with check (user_id = auth.uid());
create policy push_update on public.push_subscriptions for update using (user_id = auth.uid());
create policy push_delete on public.push_subscriptions for delete using (user_id = auth.uid());

-- RPCs --

create or replace function public.create_space(p_name text)
returns public.spaces language plpgsql security definer set search_path = public as $$
declare
  new_space public.spaces;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.spaces (name, invite_code, created_by)
  values (trim(p_name), public.generate_invite_code(), auth.uid())
  returning * into new_space;

  insert into public.space_members (space_id, user_id, role)
  values (new_space.id, auth.uid(), 'owner');

  return new_space;
end;
$$;

-- SECURITY DEFINER: the joiner cannot read the space yet - the point.
create or replace function public.join_space_by_code(p_code text)
returns public.spaces language plpgsql security definer set search_path = public as $$
declare
  target public.spaces;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into target from public.spaces
  where invite_code = upper(trim(p_code));

  if target.id is null then
    raise exception 'no_such_code' using errcode = 'P0002';
  end if;

  insert into public.space_members (space_id, user_id, role)
  values (target.id, auth.uid(), 'member')
  on conflict (space_id, user_id) do nothing;

  return target;
end;
$$;

-- The last owner cannot walk out and orphan the space.
create or replace function public.leave_space(p_space uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.is_owner(p_space)
     and (select count(*) from public.space_members where space_id = p_space and role = 'owner') = 1
     and (select count(*) from public.space_members where space_id = p_space) > 1
  then
    raise exception 'last_owner' using errcode = 'P0001';
  end if;

  delete from public.space_members where space_id = p_space and user_id = auth.uid();

  -- An empty space is nobody's, so it goes.
  if not exists (select 1 from public.space_members where space_id = p_space) then
    delete from public.spaces where id = p_space;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;

-- server settings --
-- RLS with no policy = blocked for everyone except service_role; hence no
-- secrets live anywhere in the Supabase dashboard config.

create table if not exists public.app_config (
  id                boolean primary key default true check (id),
  vapid_public_key  text not null,
  vapid_private_key text not null,
  vapid_subject     text not null,
  functions_url     text not null,
  -- Generated automatically; nobody types this in.
  cron_secret       text not null
    default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);

alter table public.app_config enable row level security;
-- No policy = blocked for everyone; service_role bypasses RLS and can still read.
revoke all on public.app_config from anon, authenticated;

insert into public.app_config (id, vapid_public_key, vapid_private_key, vapid_subject, functions_url)
select
  true,
  'BCyWeQPwL0wQSPWcWi1WBDVvzkHiU6Q8BIMi5w1BL5pwQAKGyBV1Ocl4lr00HRworVm0bXanVcvcKniK32FgL8c',
  v.vapid_private_key,
  'mailto:' || v.contact_email,
  'https://' || v.project_ref || '.supabase.co/functions/v1/send-reminders'
from private_setup.values() v
-- Both halves of the key pair must update together: a mismatched pair means
-- every notification silently fails.
on conflict (id) do update set
  vapid_public_key  = excluded.vapid_public_key,
  vapid_private_key = excluded.vapid_private_key,
  vapid_subject     = excluded.vapid_subject,
  functions_url     = excluded.functions_url;

-- If the values above were left blank, better to fail here than in a week.
do $$
declare
  cfg public.app_config;
begin
  select * into cfg from public.app_config;
  if cfg.vapid_private_key like 'PASTE_%' or cfg.functions_url like '%PASTE_%' then
    raise exception using
      message = 'Missing values in the setup block at the top of the file',
      hint = 'Fill in project_ref and vapid_private_key at the top of the script, then run it again.';
  end if;
end $$;

-- the periodic job --
-- pg_cron wakes every 15 minutes; the notification_log key (created in
-- 0002_tasks.sql) limits each person to one push per task per local day.

-- Supabase puts these in extensions on newer projects; not every version
-- allows that, so this tries both.
do $$
begin
  begin
    create extension if not exists pg_cron with schema extensions;
  exception when others then
    create extension if not exists pg_cron;
  end;
exception when others then
  raise exception using
    message = 'Could not install pg_cron',
    hint = 'Enable it manually: Supabase -> Database -> Extensions -> pg_cron, then run this again.';
end $$;

do $$
begin
  begin
    create extension if not exists pg_net with schema extensions;
  exception when others then
    create extension if not exists pg_net;
  end;
exception when others then
  raise exception using
    message = 'Could not install pg_net',
    hint = 'Enable it manually: Supabase -> Database -> Extensions -> pg_net, then run this again.';
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'househero-reminders') then
    perform cron.unschedule('househero-reminders');
  end if;
end $$;

-- The URL and secret are read at run time, so swapping either is one UPDATE.
select cron.schedule(
  'househero-reminders',
  '*/15 * * * *',
  $job$
    select net.http_post(
      url := (select functions_url from public.app_config),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select cron_secret from public.app_config)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $job$
);

-- To check: select jobname, schedule, active from cron.job;

do $$
begin
  raise notice '✅ Part 1 done. Now run 0002_tasks.sql, then 0003_rewards.sql.';
end $$;
