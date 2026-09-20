import { t } from './i18n'
import { COLD_START_RETRY_DELAYS_MS, withRetry } from './retry'
import { supabase } from './supabase'
import type {
  Member,
  Profile,
  ReminderPolicy,
  Reward,
  RewardRedemption,
  Space,
  Task,
  TaskCompletion,
  TaskHistoryEntry,
} from './types'
import type { EndCondition, RecurrenceMode, TaskType } from './taskDue'

// Thin wrappers over the queries the screens need. Errors are thrown rather
// than returned so callers can use one try/catch per user action, and RLS does
// the access control - none of these functions filter by user themselves.

export async function fetchProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
  if (error) throw error
  return data as Profile
}

export async function updateProfile(userId: string, patch: Partial<Profile>): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select()
    .single()
  if (error) throw error
  return data as Profile
}

/**
 * Everyone the signed-in user shares a space with, plus themselves. RLS
 * decides the set; the app just needs the names and points to display.
 */
export async function fetchPeople(): Promise<
  Pick<Profile, 'id' | 'display_name' | 'avatar_url' | 'email' | 'lifetime_points' | 'spendable_points'>[]
> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url, email, lifetime_points, spendable_points')
  if (error) throw error
  return data ?? []
}

export async function fetchSpaces(): Promise<Space[]> {
  const { data, error } = await supabase.from('spaces').select('*').order('created_at')
  if (error) throw error
  return (data ?? []) as Space[]
}

export async function createSpace(name: string): Promise<Space> {
  const { data, error } = await supabase.rpc('create_space', { p_name: name }).single()
  if (error) throw error
  return data as Space
}

export async function joinSpace(code: string): Promise<Space> {
  const { data, error } = await supabase
    .rpc('join_space_by_code', { p_code: code.trim().toUpperCase() })
    .single()
  if (error) {
    throw new Error(error.message.includes('no_such_code') ? t().errors.noSuchCode : error.message)
  }
  return data as Space
}

export async function leaveSpace(spaceId: string): Promise<void> {
  const { error } = await supabase.rpc('leave_space', { p_space: spaceId })
  if (error) {
    throw new Error(error.message.includes('last_owner') ? t().errors.lastOwner : error.message)
  }
}

export async function renameSpace(spaceId: string, name: string): Promise<void> {
  const { error } = await supabase.from('spaces').update({ name }).eq('id', spaceId)
  if (error) throw error
}

export async function deleteSpace(spaceId: string): Promise<void> {
  const { error } = await supabase.from('spaces').delete().eq('id', spaceId)
  if (error) throw error
}

export async function fetchMembers(spaceId: string): Promise<Member[]> {
  const { data, error } = await supabase
    .from('space_members')
    .select('space_id, user_id, role, joined_at, profile:profiles(id, display_name, avatar_url, email)')
    .eq('space_id', spaceId)
    .order('joined_at')
  if (error) throw error
  return (data ?? []) as unknown as Member[]
}

export async function fetchTasks(spaceId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('space_id', spaceId)
    .order('due_date')
  if (error) throw error
  return (data ?? []) as Task[]
}

/** Every task across every space the user belongs to, for the Today view. */
export async function fetchAllTasks(): Promise<Task[]> {
  const { data, error } = await supabase.from('tasks').select('*').order('due_date')
  if (error) throw error
  return (data ?? []) as Task[]
}

export interface NewTask {
  spaceId: string
  title: string
  description?: string
  taskType: TaskType
  recurrenceMode?: RecurrenceMode
  intervalDays?: number
  weeklyDays?: number[]
  endCondition: EndCondition
  endAfterCount?: number
  endDate?: string
  points: number
  reminderHour: number
  reminderMinute: number
  dueDate: string
  assignedTo?: string | null
  /** Only meaningful when taskType is 'time_limited'. */
  startsAt?: string | null
  expiresAt?: string | null
  reminderPolicy?: ReminderPolicy | null
  /** Set when this edit converts an already-completed-at-least-once
   *  recurring task into one_time/time_limited - those types have only a
   *  single completion to give, and this one already happened under the
   *  task's previous, recurring identity. Without this, the edit would
   *  otherwise leave is_done untouched (still false) with whatever due date
   *  the last recurring completion had already advanced it to, so the task
   *  reopens itself the moment that date arrives - see saveTask() in
   *  TasksScreen.tsx for where this gets computed. */
  alreadyFinished?: boolean
}

function taskInsertPayload(task: NewTask) {
  const isTimeLimited = task.taskType === 'time_limited'
  return {
    space_id: task.spaceId,
    title: task.title.trim(),
    description: task.description?.trim() || null,
    task_type: task.taskType,
    recurrence_mode: task.taskType === 'recurring' ? (task.recurrenceMode ?? null) : null,
    interval_days: task.taskType === 'recurring' && task.recurrenceMode === 'interval' ? task.intervalDays : null,
    weekly_days:
      task.taskType === 'recurring' && task.recurrenceMode === 'weekly_days' ? task.weeklyDays : null,
    end_condition: task.taskType === 'recurring' ? task.endCondition : 'never',
    end_after_count:
      task.taskType === 'recurring' && task.endCondition === 'after_count' ? task.endAfterCount : null,
    end_date: task.taskType === 'recurring' && task.endCondition === 'on_date' ? task.endDate : null,
    points: task.points,
    // due_date/reminder_hour/reminder_minute are NOT NULL for every task type,
    // but a time-limited task is never actually classified from them - its
    // status comes from starts_at/expires_at instead - so these just mirror
    // the window's own start/end rather than exposing their own form fields.
    reminder_hour: isTimeLimited ? new Date(task.startsAt ?? task.dueDate).getUTCHours() : task.reminderHour,
    reminder_minute: isTimeLimited ? new Date(task.startsAt ?? task.dueDate).getUTCMinutes() : task.reminderMinute,
    due_date: isTimeLimited ? (task.expiresAt ?? task.dueDate).slice(0, 10) : task.dueDate,
    assigned_to: task.assignedTo || null,
    starts_at: isTimeLimited ? (task.startsAt ?? null) : null,
    expires_at: isTimeLimited ? (task.expiresAt ?? null) : null,
    reminder_policy: isTimeLimited ? (task.reminderPolicy ?? null) : null,
    ...(task.alreadyFinished ? { is_done: true } : {}),
  }
}

export async function createTask(task: NewTask, userId: string): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    .insert({ ...taskInsertPayload(task), created_by: userId })
    .select()
    .single()
  if (error) throw error
  return data as Task
}

export async function updateTask(taskId: string, task: NewTask): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    .update(taskInsertPayload(task))
    .eq('id', taskId)
    .select()
    .single()
  if (error) throw error
  return data as Task
}

export async function deleteTask(taskId: string): Promise<void> {
  const { error } = await supabase.from('tasks').delete().eq('id', taskId)
  if (error) throw error
}

/**
 * Calls off a time-limited task before its window closes on its own - a
 * plain field update, not an RPC, since there is no schedule to advance and
 * no points to award or reverse, unlike completing one.
 */
export async function cancelTask(taskId: string): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    .update({ is_done: true, cancelled_at: new Date().toISOString() })
    .eq('id', taskId)
    .select()
    .single()
  if (error) throw error
  return data as Task
}

/**
 * Tells the assigned person, right now, that a task is theirs - separate
 * from the due-date reminder they will still get later. Best-effort and
 * silent on purpose: whoever just saved the task should never see an error
 * over a notification that is not the thing they were actually doing, so
 * callers fire this without awaiting its result.
 */
export async function notifyAssignment(taskId: string): Promise<void> {
  try {
    await withRetry(async () => {
      const { error } = await supabase.functions.invoke('send-assignment', { body: { taskId } })
      if (error) throw error
    }, COLD_START_RETRY_DELAYS_MS)
  } catch (cause) {
    console.error('could not send the assignment notification', cause)
  }
}

export interface CompletionChoice {
  /** Everyone to credit with the task's full point value - not split
   * between them. Omitted or empty defaults to whoever calls this. */
  userIds?: string[]
  /** ISO instant this actually happened, when it was not just now - "I did
   *  the dishes last night, forgot to check it off". Omitted defaults to the
   *  moment this call reaches the server, same as always. */
  completedAt?: string
}

/**
 * Completes a task and awards its points. There is no due-date check here on
 * purpose - anyone in the space can complete a task early, which is exactly
 * the "I can see it needs doing right now" case.
 *
 * By default this credits whoever calls it, same as always. `choice` lets
 * the caller instead credit someone else, or several people at once, and/or
 * log it for an earlier moment - see complete_task() for how each is
 * recorded and why a future completedAt is rejected there too.
 */
export async function completeTask(
  taskId: string,
  today: string,
  choice: CompletionChoice = {},
): Promise<TaskCompletion> {
  const { data, error } = await supabase
    .rpc('complete_task', {
      p_task: taskId,
      p_today: today,
      p_completed_by: choice.userIds && choice.userIds.length > 0 ? choice.userIds : null,
      // Left out entirely (rather than sending the client's own clock) when
      // nothing was picked, so the common case still gets the server's own
      // now() - the one clock every device already has to agree with.
      ...(choice.completedAt ? { p_completed_at: choice.completedAt } : {}),
    })
    .single()
  if (error) throw error
  return data as TaskCompletion
}

/**
 * Reverses a task's most recent completion and returns the restored task row.
 * The database - not this function - is what actually enforces that only the
 * person who completed it can undo it.
 */
export async function undoTaskCompletion(taskId: string): Promise<Task> {
  const { data, error } = await supabase.rpc('undo_last_completion', { p_task: taskId }).single()
  if (error) {
    throw new Error(
      error.message.includes('not_your_completion') ? t().errors.notYourCompletion : error.message,
    )
  }
  return data as Task
}

/** Every task this person has personally snoozed. */
export async function fetchSnoozes(userId: string): Promise<{ task_id: string; snoozed_until: string }[]> {
  const { data, error } = await supabase
    .from('task_snoozes')
    .select('task_id, snoozed_until')
    .eq('user_id', userId)
  if (error) throw error
  return data ?? []
}

/**
 * Defers this one person's reminder for one task until `until`. Personal, not
 * shared: it never touches the task row, so anyone else in the space still
 * sees it as due and still gets their own reminder on schedule.
 */
export async function snoozeTask(taskId: string, userId: string, until: string): Promise<void> {
  const { error } = await supabase
    .from('task_snoozes')
    .upsert({ task_id: taskId, user_id: userId, snoozed_until: until }, { onConflict: 'task_id,user_id' })
  if (error) throw error
}

export async function cancelSnooze(taskId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('task_snoozes')
    .delete()
    .eq('task_id', taskId)
    .eq('user_id', userId)
  if (error) throw error
}

/** Every task this person has personally set their own reminder time for. */
export async function fetchReminderOverrides(
  userId: string,
): Promise<{ task_id: string; reminder_hour: number; reminder_minute: number }[]> {
  const { data, error } = await supabase
    .from('task_reminder_overrides')
    .select('task_id, reminder_hour, reminder_minute')
    .eq('user_id', userId)
  if (error) throw error
  return data ?? []
}

/**
 * Sets this one person's own reminder time for one task. Personal, not
 * shared: it never touches the task row, so anyone else in the space still
 * gets reminded at the time set on the task itself.
 */
export async function setReminderOverride(
  taskId: string,
  userId: string,
  reminderHour: number,
  reminderMinute: number,
): Promise<void> {
  const { error } = await supabase.from('task_reminder_overrides').upsert(
    { task_id: taskId, user_id: userId, reminder_hour: reminderHour, reminder_minute: reminderMinute },
    { onConflict: 'task_id,user_id' },
  )
  if (error) throw error
}

/** Reverts back to the task's own reminder time. */
export async function clearReminderOverride(taskId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('task_reminder_overrides')
    .delete()
    .eq('task_id', taskId)
    .eq('user_id', userId)
  if (error) throw error
}

/** Recent completions for a task, newest first. */
export async function fetchHistory(taskId: string, limit = 20): Promise<TaskHistoryEntry[]> {
  const { data, error } = await supabase
    .from('task_completions')
    .select('id, user_id, points_awarded, completed_on, created_at, completion_group')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as TaskHistoryEntry[]
}

export async function fetchRewards(spaceId: string): Promise<Reward[]> {
  const { data, error } = await supabase
    .from('rewards')
    .select('*')
    .eq('space_id', spaceId)
    .order('cost')
  if (error) throw error
  return (data ?? []) as Reward[]
}

export interface NewReward {
  spaceId: string
  title: string
  description?: string
  cost: number
}

export async function createReward(reward: NewReward, userId: string): Promise<Reward> {
  const { data, error } = await supabase
    .from('rewards')
    .insert({
      space_id: reward.spaceId,
      title: reward.title.trim(),
      description: reward.description?.trim() || null,
      cost: reward.cost,
      created_by: userId,
    })
    .select()
    .single()
  if (error) throw error
  return data as Reward
}

export async function updateReward(rewardId: string, patch: Partial<Reward>): Promise<Reward> {
  const { data, error } = await supabase.from('rewards').update(patch).eq('id', rewardId).select().single()
  if (error) throw error
  return data as Reward
}

export async function deleteReward(rewardId: string): Promise<void> {
  const { error } = await supabase.from('rewards').delete().eq('id', rewardId)
  if (error) throw error
}

/** Every redemption in a space - pending ones drive the approval queue. */
export async function fetchRedemptions(spaceId: string): Promise<RewardRedemption[]> {
  const { data, error } = await supabase
    .from('reward_redemptions')
    .select('*')
    .eq('space_id', spaceId)
    .order('requested_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as RewardRedemption[]
}

export async function requestRedemption(rewardId: string): Promise<RewardRedemption> {
  const { data, error } = await supabase.rpc('request_redemption', { p_reward: rewardId }).single()
  if (error) throw error
  return data as RewardRedemption
}

export async function approveRedemption(redemptionId: string): Promise<RewardRedemption> {
  const { data, error } = await supabase.rpc('approve_redemption', { p_redemption: redemptionId }).single()
  if (error) {
    throw new Error(
      error.message.includes('insufficient_points')
        ? t().rewards.notEnoughPoints
        : error.message.includes('cannot_approve_own_request')
          ? t().rewards.cannotDecideOwn
          : error.message,
    )
  }
  return data as RewardRedemption
}

export async function rejectRedemption(redemptionId: string): Promise<RewardRedemption> {
  const { data, error } = await supabase.rpc('reject_redemption', { p_redemption: redemptionId }).single()
  if (error) {
    throw new Error(
      error.message.includes('cannot_reject_own_request') ? t().rewards.cannotDecideOwn : error.message,
    )
  }
  return data as RewardRedemption
}

/** Withdraws your own still-pending request. Only the requester may call this. */
export async function cancelRedemption(redemptionId: string): Promise<RewardRedemption> {
  const { data, error } = await supabase.rpc('cancel_redemption', { p_redemption: redemptionId }).single()
  if (error) throw error
  return data as RewardRedemption
}

export interface StatsCompletion {
  task_id: string
  user_id: string
  points_awarded: number
  completed_on: string
  /** The exact instant this completion was logged - completed_on is only a
   *  calendar day, so this is what a person's own completion breakdown
   *  shows the time of. */
  created_at: string
  /** The task's own due_date at the moment of this completion - captured for
   *  undo, and reused here to tell whether it landed on time or late without
   *  needing a separate column of its own. */
  prev_due_date: string
  task: {
    title: string
    task_type: TaskType
    recurrence_mode: RecurrenceMode | null
    interval_days: number | null
    weekly_days: number[] | null
  } | null
  /** Non-null only when several people were credited for the same
   * completion - every row it produced shares this id, so counting "how
   * many times has this been done" can count that group once, not once
   * per person credited. */
  completion_group: string | null
}

/** Every completion in a space, for the Stats screen to aggregate client-side. */
export async function fetchStatsCompletions(spaceId: string): Promise<StatsCompletion[]> {
  const { data, error } = await supabase
    .from('task_completions')
    .select(
      'task_id, user_id, points_awarded, completed_on, created_at, prev_due_date, completion_group, ' +
        'task:tasks(title, task_type, recurrence_mode, interval_days, weekly_days)',
    )
    .eq('space_id', spaceId)
    .order('completed_on', { ascending: false })
    .limit(1000)
  if (error) throw error
  return (data ?? []) as unknown as StatsCompletion[]
}
