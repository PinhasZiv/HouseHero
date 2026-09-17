import { describe, expect, it } from 'vitest'
import { reconcileReloadedTasks } from './reconcileTasks'
import type { Task } from './types'

function task(overrides: Partial<Task> & { id: string }): Task {
  return {
    space_id: 'space-1',
    title: 'task',
    description: null,
    task_type: 'recurring',
    recurrence_mode: 'interval',
    interval_days: 1,
    weekly_days: null,
    end_condition: 'never',
    end_after_count: null,
    end_date: null,
    occurrences_completed: 0,
    points: 5,
    reminder_hour: 9,
    reminder_minute: 0,
    due_date: '2026-09-17',
    last_completed_date: null,
    last_completed_at: null,
    last_completed_by: null,
    last_completed_actor: null,
    is_done: false,
    assigned_to: null,
    created_by: 'user-1',
    created_at: '2026-01-01T00:00:00Z',
    starts_at: null,
    expires_at: null,
    reminder_policy: null,
    cancelled_at: null,
    expired_at: null,
    ...overrides,
  }
}

describe('reconcileReloadedTasks', () => {
  it('returns the fetched list untouched when realtime has not patched anything', () => {
    const fetched = [task({ id: 'a' }), task({ id: 'b' })]
    expect(reconcileReloadedTasks([task({ id: 'a' })], fetched, new Set())).toBe(fetched)
  })

  it('keeps the realtime-patched version of a task the fetch reports as stale', () => {
    // The fetch's own query ran before someone else's completion committed,
    // but its response is the one landing last - exactly the race that made
    // a completed task's checkbox silently revert until a manual reload.
    const staleFromFetch = task({ id: 'a', last_completed_date: null, is_done: false })
    const freshFromRealtime = task({
      id: 'a',
      last_completed_date: '2026-09-17',
      last_completed_by: ['other-user'],
      last_completed_actor: 'other-user',
    })
    const merged = reconcileReloadedTasks([freshFromRealtime], [staleFromFetch], new Set(['a']))
    expect(merged).toEqual([freshFromRealtime])
  })

  it('drops a task the fetch still has but realtime says was deleted', () => {
    const staleFromFetch = task({ id: 'a' })
    const merged = reconcileReloadedTasks([], [staleFromFetch], new Set(['a']))
    expect(merged).toEqual([])
  })

  it('keeps a task realtime inserted that the fetch predates', () => {
    const insertedViaRealtime = task({ id: 'new' })
    const merged = reconcileReloadedTasks([insertedViaRealtime], [], new Set(['new']))
    expect(merged).toEqual([insertedViaRealtime])
  })

  it('leaves untouched tasks exactly as the fetch reported them', () => {
    const fetchedA = task({ id: 'a', title: 'from fetch' })
    const staleLocalA = task({ id: 'a', title: 'stale local copy' })
    const merged = reconcileReloadedTasks([staleLocalA], [fetchedA], new Set(['b']))
    expect(merged).toEqual([fetchedA])
  })
})
