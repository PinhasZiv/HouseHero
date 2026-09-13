import { t } from './i18n'
import { COLD_START_RETRY_DELAYS_MS, withRetry } from './retry'
import { supabase } from './supabase'
import type {
  Member,
  Profile,
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
}

function taskInsertPayload(task: NewTask) {
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
    reminder_hour: task.reminderHour,
    reminder_minute: task.reminderMinute,
    due_date: task.dueDate,
    assigned_to: task.assignedTo || null,
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
}

/**
 * Completes a task and awards its points. There is no due-date check here on
 * purpose - anyone in the space can complete a task early, which is exactly
 * the "I can see it needs doing right now" case.
 *
 * By default this credits whoever calls it, same as always. `choice` lets
 * the caller instead credit someone else, or several people at once - see
 * complete_task() for how each is recorded.
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
  task: { title: string } | null
}

/** Every completion in a space, for the Stats screen to aggregate client-side. */
export async function fetchStatsCompletions(spaceId: string): Promise<StatsCompletion[]> {
  const { data, error } = await supabase
    .from('task_completions')
    .select('task_id, user_id, points_awarded, completed_on, task:tasks(title)')
    .eq('space_id', spaceId)
    .order('completed_on', { ascending: false })
    .limit(1000)
  if (error) throw error
  return (data ?? []) as unknown as StatsCompletion[]
}
