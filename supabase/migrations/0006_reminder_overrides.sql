-- Personal, per-user reminder time for one task - never touches the task
-- itself, so anyone else in the space still sees (and is reminded by) the
-- reminder time set on the task. Whoever has a row here gets reminded at
-- their own hour instead, for that task, even when it is assigned to them
-- with a time someone else chose. Same shape as task_snoozes for the same
-- reason: a personal override that must never leak to anyone but its owner.
create table if not exists public.task_reminder_overrides (
  task_id         uuid not null references public.tasks(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  reminder_hour   smallint not null check (reminder_hour between 0 and 23),
  reminder_minute smallint not null check (reminder_minute between 0 and 59),
  created_at      timestamptz not null default now(),
  primary key (task_id, user_id)
);

alter table public.task_reminder_overrides enable row level security;

drop policy if exists task_reminder_overrides_select on public.task_reminder_overrides;
drop policy if exists task_reminder_overrides_insert on public.task_reminder_overrides;
drop policy if exists task_reminder_overrides_update on public.task_reminder_overrides;
drop policy if exists task_reminder_overrides_delete on public.task_reminder_overrides;

create policy task_reminder_overrides_select on public.task_reminder_overrides for select
  using (user_id = auth.uid());
create policy task_reminder_overrides_insert on public.task_reminder_overrides for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.tasks t where t.id = task_id and public.is_member(t.space_id))
  );
create policy task_reminder_overrides_update on public.task_reminder_overrides for update
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.tasks t where t.id = task_id and public.is_member(t.space_id))
  );
create policy task_reminder_overrides_delete on public.task_reminder_overrides for delete
  using (user_id = auth.uid());
