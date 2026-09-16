import type { Language } from './i18n/types'
import type { EndCondition, RecurrenceMode, TaskType } from './taskDue'

export interface Profile {
  id: string
  email: string | null
  display_name: string | null
  avatar_url: string | null
  timezone: string
  /**
   * Null until the person has been on a device once. Nullable rather than
   * defaulted so a browser-detected language is not overwritten by a server
   * default the moment they sign in.
   */
  language: Language | null
  lifetime_points: number
  spendable_points: number
}

export interface Space {
  id: string
  name: string
  invite_code: string
  created_by: string
  created_at: string
}

export interface Member {
  space_id: string
  user_id: string
  role: 'owner' | 'member'
  joined_at: string
  profile: Pick<Profile, 'id' | 'display_name' | 'avatar_url' | 'email'> | null
}

export interface Task {
  id: string
  space_id: string
  title: string
  description: string | null
  task_type: TaskType
  recurrence_mode: RecurrenceMode | null
  interval_days: number | null
  weekly_days: number[] | null
  end_condition: EndCondition
  end_after_count: number | null
  end_date: string | null
  occurrences_completed: number
  points: number
  reminder_hour: number
  reminder_minute: number
  due_date: string
  last_completed_date: string | null
  /** Precise timestamp of the most recent completion - unlike
   *  last_completed_date (a plain day), this orders same-day completions
   *  against each other, for the completed-tasks section. */
  last_completed_at: string | null
  /** Everyone credited for the most recent completion - one id for a normal
   *  completion, several when it was logged as done by more than one person. */
  last_completed_by: string[] | null
  /** Who actually tapped Done for the most recent completion - may differ
   *  from last_completed_by when that credited someone else instead. */
  last_completed_actor: string | null
  is_done: boolean
  assigned_to: string | null
  created_by: string
  created_at: string
  /** Only meaningful for task_type 'time_limited' - see ReminderPolicy. */
  starts_at: string | null
  expires_at: string | null
  reminder_policy: ReminderPolicy | null
  cancelled_at: string | null
  expired_at: string | null
}

export type ReminderPolicyMode = 'none' | 'start_only' | 'interval'

/**
 * How a time-limited task reminds someone inside its window. `mode: 'none'`
 * and a null reminder_policy on the task mean the same thing - no reminders -
 * kept as an explicit mode rather than always encoding "none" as null so the
 * form has something concrete to hold while someone is choosing.
 */
export interface ReminderPolicy {
  mode: ReminderPolicyMode
  /** Required when mode is 'interval'; the gap between repeats, in minutes. */
  intervalMinutes: number | null
  /** An extra reminder this many minutes before expires_at, on top of
   *  whatever `mode` already sends - null means no extra reminder. */
  finalReminderMinutesBeforeExpiry: number | null
}

export interface TaskCompletion {
  id: string
  task_id: string
  space_id: string
  user_id: string
  points_awarded: number
  completed_on: string
  /** Non-null only for a "together" completion - every row of the same event shares this id. */
  completion_group: string | null
}

/**
 * One row in a task's permanent completion log. Unlike `tasks` (which only
 * ever holds the *latest* completion), this survives the day passing and
 * stays visible after the "completed today" badge is gone.
 */
export interface TaskHistoryEntry {
  id: string
  user_id: string
  points_awarded: number
  completed_on: string
  /** Non-null only for a "together" completion - every row of the same event shares this id, so the UI can collapse them into one entry. */
  completion_group: string | null
  created_at: string
}

/**
 * One person's personal deferral of one task's reminder. Snoozing never
 * touches the task itself - it only suppresses this one person's
 * notification until `snoozed_until`, so someone else in the same space
 * still sees the task as due and gets their own reminder normally.
 */
export interface TaskSnooze {
  task_id: string
  user_id: string
  snoozed_until: string
}

export interface Reward {
  id: string
  space_id: string
  title: string
  description: string | null
  cost: number
  created_by: string
  created_at: string
}

export type RedemptionStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export interface RewardRedemption {
  id: string
  space_id: string
  reward_id: string | null
  reward_title: string
  cost: number
  requested_by: string
  approved_by: string | null
  status: RedemptionStatus
  requested_at: string
  decided_at: string | null
}
