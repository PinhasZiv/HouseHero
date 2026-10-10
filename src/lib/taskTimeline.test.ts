import { describe, expect, it } from 'vitest'
import { buildTimeline, type TimelineTask } from './taskTimeline'
import { missedOccurrenceDates } from './taskDue'

// 2026-09-25, 2026-10-02 and 2026-10-09 are Fridays.
const TODAY = '2026-10-10'

function weekly(overrides: Partial<TimelineTask> = {}): TimelineTask {
  return {
    id: 't', space_id: 'home', assigned_to: null, task_type: 'recurring', recurrence_mode: 'interval',
    interval_days: 7, weekly_days: null, due_date: '2026-10-17', is_done: false, ...overrides,
  }
}

function done(id: string, on: string, prevDue: string, overrides = {}) {
  return { id, user_id: 'me', points_awarded: 10, completed_on: on, created_at: `${on}T17:00:00Z`, completion_group: null, prev_due_date: prevDue, ...overrides }
}

describe('missedOccurrenceDates', () => {
  it('lists every occurrence that went by entirely', () => {
    expect(missedOccurrenceDates(weekly(), '2026-09-25', '2026-10-10')).toEqual(['2026-09-25', '2026-10-02'])
  })

  it('is empty when done within the cycle, early, or for a one-time task', () => {
    expect(missedOccurrenceDates(weekly(), '2026-10-02', '2026-10-05')).toEqual([])
    expect(missedOccurrenceDates(weekly(), '2026-10-02', '2026-09-30')).toEqual([])
    expect(missedOccurrenceDates(weekly({ task_type: 'one_time' }), '2026-09-01', TODAY)).toEqual([])
  })

  it('walks the chosen weekdays', () => {
    // Sundays and Wednesdays, due Sunday 27 Sep, done Friday 9 Oct.
    const days = weekly({ recurrence_mode: 'weekly_days', interval_days: null, weekly_days: [0, 3] })
    expect(missedOccurrenceDates(days, '2026-09-27', '2026-10-09')).toEqual(['2026-09-27', '2026-09-30', '2026-10-04'])
  })
})

describe('buildTimeline', () => {
  it('shows what was done, by whom, and what went by in between - newest first', () => {
    const timeline = buildTimeline(
      weekly(),
      [done('c2', '2026-10-10', '2026-09-25'), done('c1', '2026-09-24', '2026-09-18', { user_id: 'dana' })],
      [],
      [],
      TODAY,
    )
    expect(timeline.map((entry) => [entry.kind, entry.date])).toEqual([
      ['done', '2026-10-10'],
      ['missed', '2026-10-02'],
      ['missed', '2026-09-25'],
      ['done', '2026-09-24'],
    ])
  })

  it('lists skips with who skipped them', () => {
    const timeline = buildTimeline(
      weekly(),
      [],
      [{ id: 's1', user_id: 'dana', skipped_on: '2026-10-09', created_at: '2026-10-09T05:15:00Z', prev_due_date: '2026-10-09' }],
      [],
      TODAY,
    )
    expect(timeline).toEqual([
      { kind: 'skipped', key: 's1', date: '2026-10-09', createdAt: '2026-10-09T05:15:00Z', userId: 'dana' },
    ])
  })

  it('counts the stretch still open now', () => {
    const timeline = buildTimeline(weekly({ due_date: '2026-09-25' }), [], [], [], TODAY)
    expect(timeline.map((entry) => entry.date)).toEqual(['2026-10-02', '2026-09-25'])
  })

  it('does not count the open stretch as missed while the task is frozen for a vacation', () => {
    expect(buildTimeline(weekly({ due_date: '2026-09-25' }), [], [], [], TODAY, true)).toEqual([])
  })

  it('collapses a together completion into one entry that knows how many were credited', () => {
    const rows = [
      done('a', '2026-10-09', '2026-10-09', { completion_group: 'g' }),
      done('b', '2026-10-09', '2026-10-09', { completion_group: 'g', user_id: 'dana' }),
    ]
    const timeline = buildTimeline(weekly(), rows, [], [], TODAY)
    expect(timeline).toHaveLength(1)
    expect(timeline[0]).toMatchObject({ kind: 'done', people: 2 })
  })

  it('includes vacations of the whole space and of whoever the task is assigned to', () => {
    const pauses = [
      { id: 'p1', space_id: 'home', user_id: null, started_on: '2026-09-01', ended_on: '2026-09-08' },
      { id: 'p2', space_id: 'home', user_id: 'dana', started_on: '2026-09-15', ended_on: null },
      { id: 'p3', space_id: 'home', user_id: 'yossi', started_on: '2026-09-20', ended_on: null },
      { id: 'p4', space_id: 'cabin', user_id: null, started_on: '2026-09-22', ended_on: null },
    ]
    const timeline = buildTimeline(weekly({ assigned_to: 'dana' }), [], [], pauses, TODAY)
    expect(timeline.map((entry) => entry.key)).toEqual(['pause-p2', 'pause-p1'])
  })

  it('treats a completion with no due-date snapshot as on time', () => {
    const timeline = buildTimeline(weekly(), [done('c', '2026-10-10', '')], [], [], TODAY)
    expect(timeline.map((entry) => entry.kind)).toEqual(['done'])
  })
})
