-- When a completion was marked, as opposed to when it happened. A completion
-- can be backdated ("did it last night, forgot to tick it") - created_at and
-- completed_on then carry the past moment, and nothing recorded the moment
-- someone actually tapped it. The app needs that to keep a task marked today
-- in "done today", and undoable, even when it was done yesterday.
--
-- Filled in by the default; complete_task() itself is unchanged. Rows from
-- before this column existed get their created_at - the best record there is.

alter table public.task_completions add column if not exists logged_at timestamptz;
update public.task_completions set logged_at = created_at where logged_at is null;
alter table public.task_completions alter column logged_at set default now();
alter table public.task_completions alter column logged_at set not null;

create index if not exists task_completions_logged_idx on public.task_completions(space_id, logged_at);
