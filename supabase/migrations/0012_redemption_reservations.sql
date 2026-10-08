-- A request used to go through no matter the balance - it only failed later,
-- when someone tried to approve it, and several pending requests could
-- together promise more points than the requester had. Now a request has to
-- fit in what is left after this person's own still-pending requests.
-- approve_redemption() keeps its own check: the balance can still drop in
-- between (an undone completion).

create or replace function public.request_redemption(p_reward uuid)
returns public.reward_redemptions language plpgsql security definer set search_path = public as $$
declare
  target    public.rewards;
  balance   integer;
  reserved  integer;
  result    public.reward_redemptions;
begin
  select * into target from public.rewards where id = p_reward;
  if target.id is null then
    raise exception 'no_such_reward' using errcode = 'P0002';
  end if;
  if not public.is_member(target.space_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  select spendable_points into balance from public.profiles where id = auth.uid();
  select coalesce(sum(cost), 0) into reserved from public.reward_redemptions
  where requested_by = auth.uid() and status = 'pending';
  if coalesce(balance, 0) - reserved < target.cost then
    raise exception 'insufficient_points' using errcode = 'P0001';
  end if;

  insert into public.reward_redemptions (space_id, reward_id, reward_title, cost, requested_by)
  values (target.space_id, target.id, target.title, target.cost, auth.uid())
  returning * into result;

  return result;
end;
$$;

revoke execute on function public.request_redemption(uuid) from public, anon;
grant execute on function public.request_redemption(uuid) to authenticated;
