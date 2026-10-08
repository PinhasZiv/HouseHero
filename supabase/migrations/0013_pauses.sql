-- Vacation mode. A pause is either one person's ("I'm away") or the whole
-- space's ("we're all away", owner only), and it is switched on and off by
-- hand - no date ranges. While it is on:
--   - a personal pause freezes the tasks assigned to that person, in this
--     space only, and stops every reminder to them from this space;
--     unassigned tasks carry on for everyone else;
--   - a space pause freezes every task in the space and every reminder.
-- Nothing counts as late while frozen, and switching the pause off restarts
-- the frozen tasks on the day of return - including any that were already
-- late before leaving (see end_pause()).

create table if not exists public.pauses (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces(id) on delete cascade,
  -- Null means the whole space.
  user_id     uuid references public.profiles(id) on delete cascade,
  started_on  date not null,
  -- Null while the pause is on; the day of return once it is switched off.
  ended_on    date,
  created_by  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  check (ended_on is null or ended_on >= started_on)
);

create index if not exists pauses_space_idx on public.pauses(space_id);
create index if not exists pauses_user_idx on public.pauses(user_id);
-- At most one pause switched on per scope at a time.
create unique index if not exists pauses_one_active
  on public.pauses (space_id, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where ended_on is null;

alter table public.pauses enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'pauses' and policyname = 'pauses_select'
  ) then
    create policy pauses_select on public.pauses for select using (public.is_member(space_id));
  end if;
end;
$$;

-- Written only through start_pause()/end_pause() below.
revoke insert, update, delete on public.pauses from anon, authenticated;

-- "Today" for the caller, in their own timezone - the same day the app shows.
create or replace function public.caller_today()
returns date language sql security definer stable set search_path = public as $$
  select (now() at time zone coalesce(
    (select timezone from public.profiles where id = auth.uid()), 'UTC'
  ))::date;
$$;

revoke execute on function public.caller_today() from public, anon, authenticated;

create or replace function public.start_pause(p_space uuid, p_whole_space boolean)
returns public.pauses language plpgsql security definer set search_path = public as $$
declare
  result public.pauses;
begin
  if not public.is_member(p_space) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if p_whole_space and not public.is_owner(p_space) then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.pauses
    where space_id = p_space and ended_on is null
      and user_id is not distinct from (case when p_whole_space then null else auth.uid() end)
  ) then
    raise exception 'already_paused' using errcode = 'P0001';
  end if;

  insert into public.pauses (space_id, user_id, started_on, created_by)
  values (p_space, case when p_whole_space then null else auth.uid() end, public.caller_today(), auth.uid())
  returning * into result;

  return result;
end;
$$;

-- Switches a pause off and restarts what it froze: every open, non
-- time-limited task due before today (all of the space's, or just the ones
-- assigned to the person returning) becomes due today - or, for a task on
-- fixed weekdays, on the first of its weekdays from today. A time-limited
-- task keeps its own window; the pause only silenced its reminders.
create or replace function public.end_pause(p_pause uuid)
returns public.pauses language plpgsql security definer set search_path = public as $$
declare
  target public.pauses;
  today  date := public.caller_today();
  result public.pauses;
begin
  select * into target from public.pauses where id = p_pause;
  if target.id is null then
    raise exception 'no_such_pause' using errcode = 'P0002';
  end if;
  if target.user_id is null then
    if not public.is_owner(target.space_id) then
      raise exception 'not_owner' using errcode = '42501';
    end if;
  elsif target.user_id <> auth.uid() then
    raise exception 'not_your_pause' using errcode = '42501';
  end if;
  if target.ended_on is not null then
    return target;
  end if;

  update public.tasks t set due_date = case
      when t.recurrence_mode = 'weekly_days' and t.weekly_days is not null then
        coalesce(
          (select min(today + o) from generate_series(0, 6) o
           where extract(dow from today + o)::smallint = any (t.weekly_days)),
          today
        )
      else today
    end
  where t.space_id = target.space_id
    and not t.is_done
    and t.task_type <> 'time_limited'
    and t.due_date < today
    and (target.user_id is null or t.assigned_to = target.user_id);

  update public.pauses set ended_on = greatest(today, started_on)
  where id = target.id
  returning * into result;

  return result;
end;
$$;

revoke execute on function public.start_pause(uuid, boolean) from public, anon;
revoke execute on function public.end_pause(uuid) from public, anon;
grant execute on function public.start_pause(uuid, boolean) to authenticated;
grant execute on function public.end_pause(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pauses'
  ) then
    alter publication supabase_realtime add table public.pauses;
  end if;
end;
$$;
