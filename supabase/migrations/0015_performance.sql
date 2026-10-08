-- Housekeeping from Supabase's performance advisor. Nothing here changes who
-- can see or do what - only how cheaply Postgres works it out.

-- 1. RLS: `auth.uid()` written bare is re-evaluated for every row a policy
-- looks at; wrapped in a sub-select it is evaluated once per query. Same
-- rules, word for word otherwise. ALTER POLICY rewrites them in place.
-- (task_completions_insert and task_skips_insert are not here: 0009 removed
-- them - those rows are written only by SECURITY DEFINER functions.)

alter policy notification_log_select on public.notification_log
  using (user_id = (select auth.uid()));

alter policy profiles_select on public.profiles
  using (id = (select auth.uid()) or public.shares_space_with(id));
alter policy profiles_update on public.profiles
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

alter policy push_select on public.push_subscriptions using (user_id = (select auth.uid()));
alter policy push_insert on public.push_subscriptions with check (user_id = (select auth.uid()));
alter policy push_update on public.push_subscriptions using (user_id = (select auth.uid()));
alter policy push_delete on public.push_subscriptions using (user_id = (select auth.uid()));

alter policy rewards_insert on public.rewards
  with check (public.is_member(space_id) and created_by = (select auth.uid()));

alter policy space_members_delete on public.space_members
  using (user_id = (select auth.uid()) or public.is_owner(space_id));

alter policy task_reminder_overrides_select on public.task_reminder_overrides
  using (user_id = (select auth.uid()));
alter policy task_reminder_overrides_insert on public.task_reminder_overrides
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.tasks t where t.id = task_id and public.is_member(t.space_id))
  );
alter policy task_reminder_overrides_update on public.task_reminder_overrides
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.tasks t where t.id = task_id and public.is_member(t.space_id))
  );
alter policy task_reminder_overrides_delete on public.task_reminder_overrides
  using (user_id = (select auth.uid()));

alter policy task_snoozes_select on public.task_snoozes using (user_id = (select auth.uid()));
alter policy task_snoozes_insert on public.task_snoozes
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.tasks t where t.id = task_id and public.is_member(t.space_id))
  );
alter policy task_snoozes_update on public.task_snoozes
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.tasks t where t.id = task_id and public.is_member(t.space_id))
  );
alter policy task_snoozes_delete on public.task_snoozes using (user_id = (select auth.uid()));

alter policy tasks_insert on public.tasks
  with check (public.is_member(space_id) and created_by = (select auth.uid()));

alter policy time_limited_reminder_log_select on public.time_limited_reminder_log
  using (user_id = (select auth.uid()));

-- 2. Foreign keys without an index: deleting the row they point at (a task,
-- a reward, a person leaving) has to scan the whole referencing table.

create index if not exists notification_log_task_idx on public.notification_log(task_id);
create index if not exists time_limited_reminder_log_task_idx on public.time_limited_reminder_log(task_id);
create index if not exists reward_redemptions_reward_idx on public.reward_redemptions(reward_id);
create index if not exists reward_redemptions_requested_by_idx on public.reward_redemptions(requested_by);
create index if not exists reward_redemptions_approved_by_idx on public.reward_redemptions(approved_by);
create index if not exists rewards_created_by_idx on public.rewards(created_by);
create index if not exists spaces_created_by_idx on public.spaces(created_by);
create index if not exists task_completions_actor_idx on public.task_completions(actor_id);
create index if not exists task_reminder_overrides_user_idx on public.task_reminder_overrides(user_id);
create index if not exists task_skips_space_idx on public.task_skips(space_id);
create index if not exists task_skips_user_idx on public.task_skips(user_id);
create index if not exists task_snoozes_user_idx on public.task_snoozes(user_id);
create index if not exists tasks_created_by_idx on public.tasks(created_by);
create index if not exists tasks_last_completed_actor_idx on public.tasks(last_completed_actor);
create index if not exists tasks_last_skipped_by_idx on public.tasks(last_skipped_by);
create index if not exists pauses_created_by_idx on public.pauses(created_by);
