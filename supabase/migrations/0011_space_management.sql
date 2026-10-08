-- An invite code that leaked used to work forever - there was no way to
-- replace it. Owner only: the code is what lets anyone at all join.
create or replace function public.regenerate_invite_code(p_space uuid)
returns public.spaces language plpgsql security definer set search_path = public as $$
declare
  result public.spaces;
begin
  if not public.is_owner(p_space) then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  update public.spaces set invite_code = public.generate_invite_code()
  where id = p_space
  returning * into result;

  return result;
end;
$$;

revoke execute on function public.regenerate_invite_code(uuid) from public, anon;
grant execute on function public.regenerate_invite_code(uuid) to authenticated;

-- Whoever leaves a space (or is removed by its owner) stops being the
-- assignee of anything in it. send-reminders pushes an assigned task to its
-- assignee alone, without checking membership, so a task left assigned to
-- someone gone kept reminding them - and nobody who was still there.
create or replace function public.unassign_departed_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.tasks set assigned_to = null
  where space_id = old.space_id and assigned_to = old.user_id;
  return old;
end;
$$;

revoke execute on function public.unassign_departed_member() from public, anon, authenticated;

create or replace trigger space_members_unassign_on_leave
  after delete on public.space_members
  for each row execute function public.unassign_departed_member();
