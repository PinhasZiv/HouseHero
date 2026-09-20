-- Lets a completion be logged for a moment in the past ("I did the dishes
-- last night, forgot to check it off") instead of only ever "right now".
-- complete_task() already took the completed-on *date* as a caller-supplied
-- argument rather than always assuming today - this just extends that same
-- idea to the precise instant, which until now was hardcoded to now() for
-- both the completion event's created_at and the task's last_completed_at.
--
-- Signature grows by one parameter, so the old three-argument overload has
-- to be dropped explicitly - see 0004_shared_completions.sql for the same
-- pattern the last time this signature changed.
drop function if exists public.complete_task(uuid, date, uuid[]);

create or replace function public.complete_task(
  p_task uuid,
  p_today date,
  p_completed_by uuid[] default null,
  p_completed_at timestamptz default now()
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
  if p_completed_at > now() then
    raise exception 'future_completion' using errcode = '22007';
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
      task_id, space_id, user_id, actor_id, points_awarded, completed_on, completion_group, created_at,
      prev_due_date, prev_last_completed_date, prev_last_completed_by,
      prev_is_done, prev_occurrences_completed, prev_last_completed_at
    )
    values (
      target.id, target.space_id, member_id, auth.uid(), target.points, p_today, group_id, p_completed_at,
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
      last_completed_at     = p_completed_at,
      last_completed_by     = credited,
      last_completed_actor  = auth.uid(),
      occurrences_completed = occurrences,
      is_done               = finished
  where id = target.id;

  return first_event;
end;
$$;
