-- HouseHero - a third task type: a one-off relevant only inside a start/end
-- window (e.g. "buy milk on the way home, 17:00-20:00"). Outside its window
-- it is not "late" the way an ordinary task is - before starts_at it simply
-- is not due yet, and after expires_at it is no longer relevant at all
-- (expired), not overdue. That is a different shape from due_date +
-- reminder_hour/minute, which is why this is a new task_type rather than a
-- variant of one_time.

alter table public.tasks add column if not exists starts_at timestamptz;
alter table public.tasks add column if not exists expires_at timestamptz;
-- {"mode": "none" | "start_only" | "interval", "intervalMinutes": number | null,
--  "finalReminderMinutesBeforeExpiry": number | null}. Null means no reminders
-- at all - equivalent to mode "none", just without an empty object to keep in
-- sync with it.
alter table public.tasks add column if not exists reminder_policy jsonb;
alter table public.tasks add column if not exists cancelled_at timestamptz;
alter table public.tasks add column if not exists expired_at timestamptz;

alter table public.tasks drop constraint if exists tasks_task_type_check;
alter table public.tasks add constraint tasks_task_type_check
  check (task_type in ('one_time', 'recurring', 'time_limited'));

alter table public.tasks drop constraint if exists tasks_check;
alter table public.tasks add constraint tasks_check check (
  (
    task_type = 'one_time'
    and recurrence_mode is null and interval_days is null and weekly_days is null
    and end_condition = 'never' and end_after_count is null and end_date is null
    and starts_at is null and expires_at is null and reminder_policy is null
  )
  or
  (
    task_type = 'recurring'
    and recurrence_mode in ('interval', 'weekly_days')
    and (recurrence_mode = 'interval') = (interval_days is not null)
    and (recurrence_mode = 'weekly_days') = (weekly_days is not null)
    and (end_condition = 'after_count') = (end_after_count is not null)
    and (end_condition = 'on_date') = (end_date is not null)
    and starts_at is null and expires_at is null and reminder_policy is null
  )
  or
  (
    task_type = 'time_limited'
    and recurrence_mode is null and interval_days is null and weekly_days is null
    and end_condition = 'never' and end_after_count is null and end_date is null
    and starts_at is not null and expires_at is not null and expires_at > starts_at
  )
);

-- The existing notification_log dedups on (user_id, task_id, local_date) - one
-- slot per task per day, which is exactly wrong for a task that can remind
-- several times in the same day. This dedups on the reminder's own instant
-- instead, so it extends independently of that table rather than reshaping
-- its key for every other task that still only ever wants one push a day.
create table if not exists public.time_limited_reminder_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  slot    timestamptz not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, task_id, slot)
);

alter table public.time_limited_reminder_log enable row level security;

drop policy if exists time_limited_reminder_log_select on public.time_limited_reminder_log;
create policy time_limited_reminder_log_select on public.time_limited_reminder_log for select
  using (user_id = auth.uid());

-- complete_task() treats a time-limited task exactly like a one-time one on
-- completion - finished for good, no next occurrence to schedule - so this
-- only widens that one condition. Same signature as before, so create or
-- replace is enough; no old overload to drop.
create or replace function public.complete_task(
  p_task uuid,
  p_today date,
  p_completed_by uuid[] default null
)
returns public.task_completions language plpgsql security definer set search_path = public as $$
declare
  target        public.tasks;
  next_due      date;
  finished      boolean := false;
  occurrences   smallint;
  credited      uuid[];
  group_id      uuid;
  member_id     uuid;
  event         public.task_completions;
  first_event   public.task_completions;
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

  credited := (select array_agg(distinct id) from unnest(coalesce(p_completed_by, array[]::uuid[])) as id);
  if credited is null or array_length(credited, 1) is null then
    credited := array[auth.uid()];
  end if;
  if exists (
    select 1 from unnest(credited) as id
    where not exists (select 1 from public.space_members where space_id = target.space_id and user_id = id)
  ) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  occurrences := target.occurrences_completed + 1;

  if target.task_type in ('one_time', 'time_limited') then
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
    elsif target.end_condition = 'on_date' and next_due > target.end_date then
      finished := true;
    end if;
  end if;

  group_id := case when array_length(credited, 1) > 1 then gen_random_uuid() else null end;

  foreach member_id in array credited loop
    insert into public.task_completions (
      task_id, space_id, user_id, actor_id, points_awarded, completed_on, completion_group,
      prev_due_date, prev_last_completed_date, prev_last_completed_by,
      prev_is_done, prev_occurrences_completed, prev_last_completed_at
    )
    values (
      target.id, target.space_id, member_id, auth.uid(), target.points, p_today, group_id,
      target.due_date, target.last_completed_date, target.last_completed_by,
      target.is_done, target.occurrences_completed, target.last_completed_at
    )
    returning * into event;

    if first_event.id is null then
      first_event := event;
    end if;

    update public.profiles
    set lifetime_points  = lifetime_points + target.points,
        spendable_points = spendable_points + target.points
    where id = member_id;
  end loop;

  update public.tasks
  set due_date              = case when finished then target.due_date else next_due end,
      last_completed_date   = p_today,
      last_completed_at     = now(),
      last_completed_by     = credited,
      last_completed_actor  = auth.uid(),
      occurrences_completed = occurrences,
      is_done               = finished
  where id = target.id;

  return first_event;
end;
$$;
