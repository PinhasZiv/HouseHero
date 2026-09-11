-- HouseHero - part 2 of 3. Run after 0001_init.sql. Safe to run again on its
-- own too.

-- tasks --

create table if not exists public.tasks (
  id                     uuid primary key default gen_random_uuid(),
  space_id               uuid not null references public.spaces(id) on delete cascade,
  title                  text not null check (length(trim(title)) between 1 and 80),
  description            text,
  task_type              text not null check (task_type in ('one_time', 'recurring')),
  recurrence_mode        text check (recurrence_mode in ('interval', 'weekly_days')),
  interval_days          smallint check (interval_days between 1 and 365),
  -- 0 (Sunday) through 6 (Saturday), matching JS Date#getUTCDay().
  weekly_days            smallint[],
  end_condition          text not null default 'never' check (end_condition in ('never', 'after_count', 'on_date')),
  end_after_count        smallint check (end_after_count between 1 and 1000),
  end_date               date,
  occurrences_completed  smallint not null default 0,
  points                 smallint not null check (points between 1 and 1000),
  reminder_hour          smallint not null check (reminder_hour between 0 and 23),
  reminder_minute        smallint not null check (reminder_minute between 0 and 59),
  due_date               date not null,
  last_completed_date    date,
  last_completed_by      uuid references auth.users(id) on delete set null,
  -- Terminal state: true once a one-time task is done, or a recurring task has
  -- hit its end condition. A finished task never becomes due again.
  is_done                boolean not null default false,
  -- Who gets notified. Null means everyone in the space (the default).
  assigned_to            uuid references public.profiles(id) on delete set null,
  created_by             uuid not null references auth.users(id) on delete cascade,
  created_at             timestamptz not null default now(),

  check (
    (
      task_type = 'one_time'
      and recurrence_mode is null and interval_days is null and weekly_days is null
      and end_condition = 'never' and end_after_count is null and end_date is null
    )
    or
    (
      task_type = 'recurring'
      and recurrence_mode in ('interval', 'weekly_days')
      and (recurrence_mode = 'interval') = (interval_days is not null)
      and (recurrence_mode = 'weekly_days') = (weekly_days is not null)
      and (end_condition = 'after_count') = (end_after_count is not null)
      and (end_condition = 'on_date') = (end_date is not null)
    )
  ),
  check (
    weekly_days is null
    or (array_length(weekly_days, 1) between 1 and 7 and weekly_days <@ array[0,1,2,3,4,5,6]::smallint[])
  )
);

create index if not exists tasks_space_idx on public.tasks(space_id);
create index if not exists tasks_due_idx on public.tasks(due_date);
create index if not exists tasks_assigned_idx on public.tasks(assigned_to);

-- Carries the pre-completion state so undo restores it exactly, and snapshots
-- the points awarded so a later edit to the task's point value never
-- retroactively changes history.
create table if not exists public.task_completions (
  id                            uuid primary key default gen_random_uuid(),
  task_id                       uuid not null references public.tasks(id) on delete cascade,
  space_id                      uuid not null references public.spaces(id) on delete cascade,
  user_id                       uuid not null references auth.users(id) on delete cascade,
  points_awarded                smallint not null,
  completed_on                  date not null,
  prev_due_date                 date not null,
  prev_last_completed_date      date,
  prev_last_completed_by        uuid,
  prev_is_done                  boolean not null,
  prev_occurrences_completed    smallint not null,
  created_at                    timestamptz not null default now()
);

create index if not exists task_completions_task_idx on public.task_completions(task_id, created_at desc);
create index if not exists task_completions_stats_idx on public.task_completions(space_id, completed_on);
create index if not exists task_completions_user_idx on public.task_completions(user_id, completed_on);

-- Personal, per-user deferral of one task's reminder - never touches the task
-- itself, so anyone else in the space still sees it as due on schedule.
create table if not exists public.task_snoozes (
  task_id       uuid not null references public.tasks(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  snoozed_until timestamptz not null,
  created_at    timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index if not exists task_snoozes_due_idx on public.task_snoozes(snoozed_until);

-- The duplicate guard: one reminder per user per task per local day, however
-- many times the cron fires or overlaps.
create table if not exists public.notification_log (
  user_id    uuid not null references auth.users(id) on delete cascade,
  task_id    uuid not null references public.tasks(id) on delete cascade,
  local_date date not null,
  kind       text not null,
  sent_at    timestamptz not null default now(),
  primary key (user_id, task_id, local_date)
);

-- RLS --

do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('tasks', 'task_completions', 'task_snoozes', 'notification_log')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

alter table public.tasks              enable row level security;
alter table public.task_completions   enable row level security;
alter table public.task_snoozes       enable row level security;
alter table public.notification_log   enable row level security;

create policy tasks_select on public.tasks for select
  using (public.is_member(space_id));
create policy tasks_insert on public.tasks for insert
  with check (public.is_member(space_id) and created_by = auth.uid());
create policy tasks_update on public.tasks for update
  using (public.is_member(space_id)) with check (public.is_member(space_id));
create policy tasks_delete on public.tasks for delete
  using (public.is_member(space_id));

create policy task_completions_select on public.task_completions for select
  using (public.is_member(space_id));
create policy task_completions_insert on public.task_completions for insert
  with check (public.is_member(space_id) and user_id = auth.uid());
-- No update/delete policy: undo_last_completion() removes rows as the table
-- owner (SECURITY DEFINER), which bypasses RLS - a client can never edit or
-- erase completion history directly.

create policy task_snoozes_select on public.task_snoozes for select
  using (user_id = auth.uid());
create policy task_snoozes_insert on public.task_snoozes for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.tasks t where t.id = task_id and public.is_member(t.space_id))
  );
create policy task_snoozes_update on public.task_snoozes for update
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.tasks t where t.id = task_id and public.is_member(t.space_id))
  );
create policy task_snoozes_delete on public.task_snoozes for delete
  using (user_id = auth.uid());

create policy notification_log_select on public.notification_log for select using (user_id = auth.uid());

-- RPCs --

-- Completes a task: logs it, advances (or finishes) its schedule, and awards
-- points - all in one transaction so none of it can drift apart.
--
-- The scheduling rules mirror supabase/functions/_shared/taskDue.ts exactly
-- (interval vs. weekly-days recurrence, the three end conditions) - see that
-- file for the reasoning. It cannot be imported here, since this runs inside
-- Postgres, so the two are kept in lockstep by hand; the same rules are
-- exercised from both sides by the unit tests.
create or replace function public.complete_task(p_task uuid, p_today date)
returns public.task_completions language plpgsql security definer set search_path = public as $$
declare
  target        public.tasks;
  next_due      date;
  finished      boolean := false;
  occurrences   smallint;
  event         public.task_completions;
begin
  select * into target from public.tasks where id = p_task;
  if target.id is null then
    raise exception 'no_such_task' using errcode = 'P0002';
  end if;
  if not public.is_member(target.space_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if target.is_done then
    raise exception 'already_done' using errcode = 'P0002';
  end if;

  occurrences := target.occurrences_completed + 1;

  if target.task_type = 'one_time' then
    finished := true;
    next_due := target.due_date;
  elsif target.recurrence_mode = 'weekly_days' then
    for i in 1..7 loop
      if (extract(dow from (p_today + i))::int = any(target.weekly_days)) then
        next_due := p_today + i;
        exit;
      end if;
    end loop;
  else
    next_due := p_today + target.interval_days;
  end if;

  if target.task_type = 'recurring' then
    if target.end_condition = 'after_count' and occurrences >= target.end_after_count then
      finished := true;
    elsif target.end_condition = 'on_date' and target.end_date is not null and next_due > target.end_date then
      finished := true;
    end if;
  end if;

  insert into public.task_completions (
    task_id, space_id, user_id, points_awarded, completed_on,
    prev_due_date, prev_last_completed_date, prev_last_completed_by,
    prev_is_done, prev_occurrences_completed
  )
  values (
    target.id, target.space_id, auth.uid(), target.points, p_today,
    target.due_date, target.last_completed_date, target.last_completed_by,
    target.is_done, target.occurrences_completed
  )
  returning * into event;

  update public.tasks
  set due_date              = case when finished then target.due_date else next_due end,
      last_completed_date   = p_today,
      last_completed_by     = auth.uid(),
      occurrences_completed = occurrences,
      is_done               = finished
  where id = target.id;

  update public.profiles
  set lifetime_points  = lifetime_points + target.points,
      spendable_points = spendable_points + target.points
  where id = auth.uid();

  return event;
end;
$$;

-- Only whoever completed it can undo - anyone may complete a task early, so
-- this guards identity, not timing.
create or replace function public.undo_last_completion(p_task uuid)
returns public.tasks language plpgsql security definer set search_path = public as $$
declare
  target public.tasks;
  event  public.task_completions;
  result public.tasks;
begin
  select * into target from public.tasks where id = p_task;
  if target.id is null then
    raise exception 'no_such_task' using errcode = 'P0002';
  end if;
  if not public.is_member(target.space_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  select * into event from public.task_completions
  where task_id = p_task order by created_at desc limit 1;
  if event.id is null then
    raise exception 'nothing_to_undo' using errcode = 'P0002';
  end if;
  if event.user_id <> auth.uid() then
    raise exception 'not_your_completion' using errcode = '42501';
  end if;

  update public.tasks
  set due_date              = event.prev_due_date,
      last_completed_date   = event.prev_last_completed_date,
      last_completed_by     = event.prev_last_completed_by,
      is_done               = event.prev_is_done,
      occurrences_completed = event.prev_occurrences_completed
  where id = event.task_id
  returning * into result;

  -- Clamped at zero: if the points were already spent on an approved reward
  -- before the undo, the balance simply cannot go negative over it.
  update public.profiles
  set lifetime_points  = greatest(0, lifetime_points - event.points_awarded),
      spendable_points = greatest(0, spendable_points - event.points_awarded)
  where id = auth.uid();

  delete from public.task_completions where id = event.id;
  return result;
end;
$$;

-- Live updates, so a task someone else completes updates on your screen
-- without you doing anything.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;
end $$;

do $$
begin
  raise notice '✅ Part 2 done. Now run 0003_rewards.sql.';
end $$;
