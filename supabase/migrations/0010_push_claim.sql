-- A device's push endpoint belongs to whoever is signed in on it now. The
-- plain upsert the app used could not do that: when the endpoint's row still
-- belonged to someone who had signed out (or whose session simply lapsed),
-- RLS refused the update, so the new person silently never got reminders on
-- that device - and the old one kept getting theirs there.
--
-- Holding the endpoint URL is proof of holding the device: it is an
-- unguessable capability the browser hands out, never shown anywhere else.

create or replace function public.claim_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, failure_count)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300), 0)
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        failure_count = 0;
end;
$$;

revoke execute on function public.claim_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.claim_push_subscription(text, text, text, text) to authenticated;
