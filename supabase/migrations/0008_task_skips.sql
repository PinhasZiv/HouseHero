-- Skipping one occurrence of a recurring task - "I don't actually need to do
-- this this time" (the dishwasher example: a daily task that genuinely does
-- not need running every single day). Only recurring tasks get this: a
-- one-time task that is not needed is simply deleted, and a time-limited
-- task already has its own terminal cancel() that does not need to preserve
-- a future occurrence the way this does.
--
-- Deliberately separate from task_completions: a skip earns no points,
-- credits nobody, and never appears in it - so every existing stat (on-time
-- rate, most neglected task, missed cycles) is automatically unaffected,
-- exactly as if the occurrence had never existed to measure.

alter table public.tasks add column if not exists last_skipped_date date;

-- Mirrors task_completions' own prev_* snapshot/undo shape, minus everything
-- only completion needs (points, crediting several people, occurrences_completed
-- - a skip never touches that count, so after_count end conditions are never
-- satisfied by skipping around them).
create table if not exists public.task_skips (
  id                      uuid primary key default gen_random_uuid(),
  task_id                 uuid not null references public.tasks(id) on delete cascade,
  space_id                uuid not null references public.spaces(id) on delete cascade,
  user_id                 uuid not null references auth.users(id) on delete cascade,
  skipped_on              date not null,
  prev_due_date           date not null,
  prev_last_skipped_date  date,
  prev_is_done            boolean not null,
  created_at              timestamptz not null default now()
);

create index if not exists task_skips_task_idx on public.task_skips(task_id, created_at desc);

alter table public.task_skips enable row level security;

drop policy if exists task_skips_select on public.task_skips;
drop policy if exists task_skips_insert on public.task_skips;

create policy task_skips_select on public.task_skips for select
  using (public.is_member(space_id));
create policy task_skips_insert on public.task_skips for insert
  with check (public.is_member(space_id) and user_id = auth.uid());
-- No update/delete policy: undo_last_skip() removes rows as the table owner
-- (SECURITY DEFINER), the same way undo_last_completion() already does for
-- task_completions - a client can never edit or erase skip history directly.

-- Advances (or finishes) a recurring task's schedule without crediting
-- anyone or logging a completion - the scheduling half of complete_task(),
-- with the points/crediting half removed. Mirrors
-- supabase/functions/_shared/taskDue.ts's planSkip() the same way
-- complete_task() mirrors planCompletion() - see that file for the
-- reasoning, and 0002_tasks.sql's complete_task() for why this cannot
-- simply import it.
create or replace function public.skip_task(
  p_task uuid,
  p_today date,
  p_skipped_at timestamptz default now()
)
returns public.task_skips language plpgsql security definer set search_path = public as $$
declare
  target   public.tasks;
  next_due date;
  finished boolean := false;
  event    public.task_skips;
begin
  select * into target from public.tasks where id = p_task;
  if target.id is null then
    raise exception 'no_such_task' using errcode = 'P0002';
  end if;
  if not public.is_member(target.space_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if target.task_type != 'recurring' then
    raise exception 'not_recurring' using errcode = 'P0002';
  end if;
  if target.is_done then
    raise exception 'already_done' using errcode = 'P0002';
  end if;
  if p_skipped_at > now() then
    raise exception 'future_skip' using errcode = '22007';
  end if;

  if target.recurrence_mode = 'weekly_days' then
    for i in 1..7 loop
      if (extract(dow from (p_today + i))::int = any(target.weekly_days)) then
        next_due := p_today + i;
        exit;
      end if;
    end loop;
  else
    next_due := p_today + target.interval_days;
  end if;

  if target.end_condition = 'after_count' and target.occurrences_completed >= target.end_after_count then
    finished := true;
  elsif target.end_condition = 'on_date' and next_due > target.end_date then
    finished := true;
  end if;

  insert into public.task_skips (
    task_id, space_id, user_id, skipped_on, created_at,
    prev_due_date, prev_last_skipped_date, prev_is_done
  )
  values (
    target.id, target.space_id, auth.uid(), p_today, p_skipped_at,
    target.due_date, target.last_skipped_date, target.is_done
  )
  returning * into event;

  update public.tasks
  set due_date          = case when finished then target.due_date else next_due end,
      last_skipped_date = p_today,
      is_done           = finished
  where id = target.id;

  return event;
end;
$$;

-- Reverses a task's most recent skip - the same shape as
-- undo_last_completion(), just restoring the smaller set of columns a skip
-- actually touches.
create or replace function public.undo_last_skip(p_task uuid)
returns public.tasks language plpgsql security definer set search_path = public as $$
declare
  target public.tasks;
  event  public.task_skips;
  result public.tasks;
begin
  select * into target from public.tasks where id = p_task;
  if target.id is null then
    raise exception 'no_such_task' using errcode = 'P0002';
  end if;
  if not public.is_member(target.space_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  select * into event from public.task_skips
  where task_id = p_task order by created_at desc limit 1;
  if event.id is null then
    raise exception 'nothing_to_undo' using errcode = 'P0002';
  end if;
  if event.user_id != auth.uid() then
    raise exception 'not_your_skip' using errcode = '42501';
  end if;

  update public.tasks
  set due_date          = event.prev_due_date,
      last_skipped_date = event.prev_last_skipped_date,
      is_done           = event.prev_is_done
  where id = event.task_id
  returning * into result;

  delete from public.task_skips where id = event.id;

  return result;
end;
$$;
