-- Closes a way to mint (or drain) points. task_completions accepted direct
-- inserts from any space member, with any points_awarded - including a
-- negative one. undo_last_completion() then takes points_awarded off whoever
-- the row credits, so inserting a -5000 row and undoing it added 5000 points,
-- and inserting a row crediting someone else drained theirs.
--
-- Nothing in the app ever inserted into these tables directly: complete_task()
-- and skip_task() are SECURITY DEFINER and write as the table owner, so the
-- insert policies only ever opened the side door.

drop policy if exists task_completions_insert on public.task_completions;
revoke insert, update, delete on public.task_completions from anon, authenticated;
alter table public.task_completions drop constraint if exists task_completions_points_nonnegative;
alter table public.task_completions
  add constraint task_completions_points_nonnegative check (points_awarded >= 0);

-- Same side door on skips: undo_last_skip() restores a task from the row's
-- prev_* snapshot, so a forged row could rewrite a task's schedule.
drop policy if exists task_skips_insert on public.task_skips;
revoke insert, update, delete on public.task_skips from anon, authenticated;

-- Every RPC already rejects a caller with no auth.uid(), but nothing signed
-- out needs to reach them at all. Functions get EXECUTE for PUBLIC by
-- default, so it has to come off PUBLIC, not just anon.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.complete_task(uuid, date, uuid[], timestamptz)',
    'public.undo_last_completion(uuid)',
    'public.skip_task(uuid, date, timestamptz)',
    'public.undo_last_skip(uuid)',
    'public.create_space(text)',
    'public.join_space_by_code(text)',
    'public.leave_space(uuid)',
    'public.request_redemption(uuid)',
    'public.approve_redemption(uuid)',
    'public.reject_redemption(uuid)',
    'public.cancel_redemption(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;

-- Only ever called from inside create_space(), which runs as the owner.
revoke execute on function public.generate_invite_code() from public, anon, authenticated;

-- Throwaway functions left behind while debugging an earlier migration.
drop function if exists public._noop_ddl_probe();
drop function if exists public._delete_probe();
drop function if exists public._undo_last_skip_probe5(uuid);
