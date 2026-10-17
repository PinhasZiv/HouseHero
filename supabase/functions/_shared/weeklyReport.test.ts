import { describe, expect, it } from 'vitest'
import { HISTORY_LIMIT, buildWeeklyReport, latestWeekEnd, reportSince, type ReportCompletion, type ReportTask } from './weeklyReport.ts'

// The week of Sunday 11 - Saturday 17 October 2026, read on that Saturday.
const TODAY = '2026-10-17'
const ME = 'me'
const DANA = 'dana'

function task(id: string, title: string, overrides: Partial<ReportTask> = {}): ReportTask {
  return {
    id, title, task_type: 'recurring', recurrence_mode: 'interval', interval_days: 1, weekly_days: null,
    end_condition: 'never', end_after_count: null, end_date: null, occurrences_completed: 0,
    due_date: '2026-10-18', last_completed_date: TODAY, last_skipped_date: null, is_done: false,
    starts_at: null, expires_at: null, cancelled_at: null, expired_at: null, assigned_to: null,
    ...overrides,
  }
}

function done(taskId: string, on: string, who: string, extra: Partial<ReportCompletion> = {}): ReportCompletion {
  return { task_id: taskId, user_id: who, points_awarded: 10, completed_on: on, completion_group: null, prev_due_date: on, ...extra }
}

/** The dishes every day this week and last, alternating who did them. */
function dailyDishes(fromDay: number, toDay: number): ReportCompletion[] {
  const rows: ReportCompletion[] = []
  for (let d = fromDay; d <= toDay; d++) {
    const on = `2026-10-${String(d).padStart(2, '0')}`
    rows.push(done('dish', on, d % 2 ? ME : DANA))
  }
  return rows
}

const base = {
  redemptions: [],
  weekEnd: TODAY,
  today: TODAY,
  since: '2026-09-01',
  timezone: 'Asia/Jerusalem',
}

describe('latestWeekEnd', () => {
  it('is today on a Saturday, and the Saturday before on any other day', () => {
    expect(latestWeekEnd('2026-10-17')).toBe('2026-10-17')
    expect(latestWeekEnd('2026-10-18')).toBe('2026-10-17')
    expect(latestWeekEnd('2026-10-23')).toBe('2026-10-17')
    expect(latestWeekEnd('2026-10-24')).toBe('2026-10-24')
  })
})

describe('reportSince', () => {
  it('starts at the oldest task, unless a page of history was cut off later than that', () => {
    expect(reportSince('2026-01-01', [{ completed_on: '2026-05-01' }], [])).toBe('2026-01-01')
    const full = Array.from({ length: HISTORY_LIMIT }, (_, i) => ({ completed_on: i ? '2026-10-01' : '2026-06-15' }))
    expect(reportSince('2026-01-01', full, [])).toBe('2026-06-15')
    const fullSkips = Array.from({ length: HISTORY_LIMIT }, () => ({ skipped_on: '2026-07-01' }))
    expect(reportSince('2026-01-01', full, fullSkips)).toBe('2026-07-01')
  })
})

describe('buildWeeklyReport', () => {
  it('counts the week, and the week before it for comparison', () => {
    const report = buildWeeklyReport({ ...base, tasks: [task('dish', 'כלים')], completions: dailyDishes(4, 17), skips: [] })
    expect(report.weekStart).toBe('2026-10-11')
    expect(report.figures).toEqual({ done: 7, points: 70, onTime: 100 })
    expect(report.previous).toEqual({ done: 7, points: 70, onTime: 100 })
    expect(report.daysClosed).toBe(7)
    expect(report.days.map((day) => day.done)).toEqual([1, 1, 1, 1, 1, 1, 1])
  })

  it('a task done late breaks the days it waited, and missed cycles count against on-time', () => {
    // Wednesday's dishes were left and done on Thursday.
    const completions = dailyDishes(11, 17).filter((row) => row.completed_on !== '2026-10-14')
    completions.find((row) => row.completed_on === '2026-10-15')!.prev_due_date = '2026-10-14'
    const report = buildWeeklyReport({ ...base, tasks: [task('dish', 'כלים')], completions, skips: [] })
    expect(report.days.find((day) => day.date === '2026-10-14')!.status).toBe('broken')
    expect(report.daysClosed).toBe(6)
    expect(report.missed).toEqual([{ taskId: 'dish', title: 'כלים', cycles: 1 }])
    // 6 done on their day, 1 missed: 6 of 7.
    expect(report.figures.onTime).toBe(86)
    expect(report.brokeOn).toBe('2026-10-14')
    expect(report.streak).toBe(3)
  })

  it('splits the week by person, a together completion counted once for the household', () => {
    const completions = [
      ...dailyDishes(11, 16),
      done('dish', '2026-10-17', ME, { completion_group: 'g1' }),
      done('dish', '2026-10-17', DANA, { completion_group: 'g1' }),
    ]
    const report = buildWeeklyReport({ ...base, tasks: [task('dish', 'כלים')], completions, skips: [] })
    expect(report.figures.done).toBe(7)
    expect(report.figures.points).toBe(80)
    expect(report.people).toEqual([
      { userId: ME, done: 4, points: 40, together: 1, share: 50, onTime: 100 },
      { userId: DANA, done: 4, points: 40, together: 1, share: 50, onTime: 100 },
    ])
  })

  it('today is open while something still waits, and closes once it is done', () => {
    const waiting = buildWeeklyReport({
      ...base,
      tasks: [task('dish', 'כלים', { due_date: TODAY, last_completed_date: '2026-10-16' })],
      completions: dailyDishes(11, 16),
      skips: [],
    })
    expect(waiting.days[6].status).toBe('open')
    expect(waiting.daysClosed).toBe(6)
    // Every day from 1 September through yesterday; today not yet.
    expect(waiting.streak).toBe(46)

    const cleared = buildWeeklyReport({ ...base, tasks: [task('dish', 'כלים')], completions: dailyDishes(11, 17), skips: [] })
    expect(cleared.days[6].status).toBe('closed')
    expect(cleared.streak).toBe(47)
  })

  it('names the most done task, what is late right now, and the week of an earlier report has no "late now"', () => {
    const tasks = [task('dish', 'כלים'), task('oven', 'תנור', { interval_days: 14, due_date: '2026-10-14', last_completed_date: null })]
    const report = buildWeeklyReport({ ...base, tasks, completions: dailyDishes(11, 17), skips: [] })
    expect(report.topTask).toEqual({ taskId: 'dish', title: 'כלים', done: 7 })
    expect(report.overdueNow).toEqual([{ taskId: 'oven', title: 'תנור', daysLate: 3 }])

    const earlier = buildWeeklyReport({ ...base, weekEnd: '2026-10-03', tasks, completions: dailyDishes(1, 17), skips: [] })
    expect(earlier.overdueNow).toEqual([])
  })

  it('lists rewards redeemed during the week and requests still waiting', () => {
    const report = buildWeeklyReport({
      ...base,
      tasks: [task('dish', 'כלים')],
      completions: [],
      skips: [],
      redemptions: [
        { reward_title: 'ערב סרט', cost: 50, requested_by: DANA, status: 'approved', decided_at: '2026-10-13T18:00:00Z' },
        { reward_title: 'ישן', cost: 20, requested_by: ME, status: 'approved', decided_at: '2026-10-02T18:00:00Z' },
        { reward_title: 'ארוחת בוקר', cost: 120, requested_by: ME, status: 'pending', decided_at: null },
      ],
    })
    expect(report.redeemed).toEqual([{ title: 'ערב סרט', cost: 50, by: DANA }])
    expect(report.pending).toEqual([{ title: 'ארוחת בוקר', cost: 120, by: ME }])
  })

  it('days before the household began, and days still to come, are not counted', () => {
    const report = buildWeeklyReport({ ...base, today: '2026-10-15', since: '2026-10-13', tasks: [task('dish', 'כלים', { due_date: '2026-10-16' })], completions: dailyDishes(13, 15), skips: [] })
    expect(report.days.map((day) => day.status)).toEqual(['none', 'none', 'closed', 'closed', 'closed', 'future', 'future'])
    expect(report.daysCounted).toBe(3)
  })
})
