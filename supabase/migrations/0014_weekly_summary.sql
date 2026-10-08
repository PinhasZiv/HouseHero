-- The Saturday-evening weekly summary push (send-reminders). One row per
-- person per week is the whole duplicate guard: two overlapping cron runs
-- both try to insert it, and only the one that succeeds sends - the same
-- claim-by-insert pattern as notification_log.

create table if not exists public.weekly_summary_log (
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- The person's own local date of the Saturday the summary covers up to.
  week_ending  date not null,
  sent_at      timestamptz not null default now(),
  primary key (user_id, week_ending)
);

-- No policy: only the service role (the Edge Function) ever touches it.
alter table public.weekly_summary_log enable row level security;
revoke all on public.weekly_summary_log from anon, authenticated;
