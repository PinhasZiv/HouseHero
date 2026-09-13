-- HouseHero - completing a task on someone else's behalf, or crediting
-- several people (everyone, or a chosen subset) at once.
--
-- Until now complete_task() always credited whoever called it - the person
-- tapping Done was, by definition, the person who gets the points, and
-- last_completed_by was a single id. That stops holding once the Done
-- button can say "my partner did this", "we all did this", or "these two
-- of us did this": the set of credited people can now be any size, and can
-- differ from whoever actually tapped the button.

-- last_completed_by moves from "the one person credited" to "everyone
-- credited last time" - a normal uuid can't hold that, so it becomes an
-- array. The old FK can't follow (Postgres has no FK from an array column
-- to a scalar key), so membership is enforced in complete_task() itself
-- instead, the same way p_completed_by already was.
alter table public.tasks drop constraint if exists tasks_last_completed_by_fkey;
alter table public.tasks alter column last_completed_by type uuid[]
  using (case when last_completed_by is not null then array[last_completed_by] else null end);

alter table public.tasks
  -- Who actually tapped Done for the most recent completion - distinct from
  -- last_completed_by (who got the credit) once those two can differ. Kept
  -- so the client can offer Undo to the actor even when someone else was
  -- credited instead.
  add column if not exists last_completed_actor uuid references auth.users(id) on delete set null;

alter table public.task_completions
  add column if not exists actor_id uuid references auth.users(id) on delete set null;

-- Same reasoning as tasks.last_completed_by above - this snapshot has to be
-- able to hold whatever last_completed_by held right before the completion
-- being undone, which is now an array too.
alter table public.task_completions alter column prev_last_completed_by type uuid[]
  using (case when prev_last_completed_by is not null then array[prev_last_completed_by] else null end);

alter table public.task_completions
  -- Non-null only when a single action credited more than one person: every
  -- row it produces (one per credited person, each carrying the full point
  -- value) shares this id, so undo can find and reverse the whole set as
  -- one action.
  add column if not exists completion_group uuid;

-- Backfills existing rows so old history keeps working: the actor of a
-- completion nobody could previously attribute to anyone but themselves is
-- that same person.
update public.task_completions set actor_id = user_id where actor_id is null;
alter table public.task_completions alter column actor_id set not null;

create index if not exists task_completions_group_idx on public.task_completions(completion_group) where completion_group is not null;

-- The insert policy allowed only user_id = auth.uid() - no longer true once
-- a completion can credit someone other than whoever is inserting it.
-- complete_task() is SECURITY DEFINER and bypasses RLS regardless (same as
-- the delete in undo_last_completion()), but the policy should still
-- describe reality rather than a rule the function already routes around.
drop policy if exists task_completions_insert on public.task_completions;
create policy task_completions_insert on public.task_completions for insert
  with check (public.is_member(space_id) and actor_id = auth.uid());

-- Postgres identifies a function by name AND argument list, so changing the
-- argument list below would otherwise create a second complete_task()
-- overload alongside the original two-argument one rather than replacing
-- it - this drops that old signature first so exactly one survives.
drop function if exists public.complete_task(uuid, date);

-- Completes a task: logs it, advances (or finishes) its schedule, and
-- awards points - all in one transaction so none of it can drift apart.
--
-- p_completed_by lists everyone to credit, each with the task's full point
-- value - not split between them. Left null (or empty), it defaults to the
-- caller, exactly as before. A single id reproduces the original one-row
-- behaviour; more than one shares a completion_group so undo can treat them
-- as one action.
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
    elsif target.end_condition = 'on_date' and next_due > target.end_date then
      finished := true;
    end if;
  end if;

  group_id := case when array_length(credited, 1) > 1 then gen_random_uuid() else null end;

  foreach member_id in array credited loop
    insert into public.task_completions (
      task_id, space_id, user_id, actor_id, points_awarded, completed_on, completion_group,
      prev_due_date, prev_last_completed_date, prev_last_completed_by,
      prev_is_done, prev_occurrences_completed
    )
    values (
      target.id, target.space_id, member_id, auth.uid(), target.points, p_today, group_id,
      target.due_date, target.last_completed_date, target.last_completed_by,
      target.is_done, target.occurrences_completed
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
      last_completed_by     = credited,
      last_completed_actor  = auth.uid(),
      occurrences_completed = occurrences,
      is_done               = finished
  where id = target.id;

  return first_event;
end;
$$;

-- Undo may now need to reverse a whole group (every row sharing
-- completion_group) rather than one, and is allowed for whoever actually
-- tapped Done as well as anyone who was credited - not credited-only, the
-- original rule from when those were always the same person.
create or replace function public.undo_last_completion(p_task uuid)
returns public.tasks language plpgsql security definer set search_path = public as $$
declare
  target public.tasks;
  event  public.task_completions;
  member public.task_completions;
  result public.tasks;
  allowed boolean;
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

  if event.completion_group is not null then
    select exists (
      select 1 from public.task_completions
      where completion_group = event.completion_group and (user_id = auth.uid() or actor_id = auth.uid())
    ) into allowed;
  else
    allowed := auth.uid() = event.user_id or auth.uid() = event.actor_id;
  end if;
  if not allowed then
    raise exception 'not_your_completion' using errcode = '42501';
  end if;

  update public.tasks
  set due_date              = event.prev_due_date,
      last_completed_date   = event.prev_last_completed_date,
      last_completed_by     = event.prev_last_completed_by,
      last_completed_actor  = null,
      is_done               = event.prev_is_done,
      occurrences_completed = event.prev_occurrences_completed
  where id = event.task_id
  returning * into result;

  if event.completion_group is not null then
    for member in select * from public.task_completions where completion_group = event.completion_group loop
      update public.profiles
      set lifetime_points  = greatest(0, lifetime_points - member.points_awarded),
          spendable_points = greatest(0, spendable_points - member.points_awarded)
      where id = member.user_id;
    end loop;
    delete from public.task_completions where completion_group = event.completion_group;
  else
    update public.profiles
    set lifetime_points  = greatest(0, lifetime_points - event.points_awarded),
        spendable_points = greatest(0, spendable_points - event.points_awarded)
    where id = event.user_id;
    delete from public.task_completions where id = event.id;
  end if;

  return result;
end;
$$;
