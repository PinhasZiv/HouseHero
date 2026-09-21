import { useEffect, useMemo, useState } from 'react'
import * as api from '../lib/api'
import { daysBetween } from '../lib/taskDue'
import { cyclesWord, formatDateTime, weekdayName } from '../lib/format'
import { useI18n } from '../lib/i18n'
import type { Language } from '../lib/i18n/types'
import {
  busiestWeekday,
  dedupeCompletionGroups,
  inactiveMembers,
  missedCyclesSummary,
  mostNeglectedTask,
  onTimeRate,
  weeklyTrend,
  type OnTimeRate,
} from '../lib/stats'
import { useApp } from '../state/AppState'
import { useToast } from './Toast'
import { ChartIcon, StarIcon } from './Icons'
import type { StatsCompletion } from '../lib/api'

/** How many of a task's completion timestamps to list before just counting
 *  the rest - a task done daily for a year is 300+ rows, not a list anyone
 *  wants to scroll through to find out they did it a lot. */
const MAX_TIMESTAMPS_SHOWN = 20

interface TaskBreakdown {
  taskId: string
  title: string
  count: number
  /** Sum of points_awarded across every one of this person's completions of
   *  this task - not count * the task's current point value, which would be
   *  wrong the moment that value ever changed. */
  points: number
  /** Most recent first. */
  timestamps: string[]
}

/**
 * Every task one person has completed - how many times, and how many points
 * that added up to - opened by tapping their row in the leaderboard. Laid
 * out as a table rather than prose (task | times | points) so the numbers
 * are scannable at a glance instead of each needing its own sentence; a
 * recurring task's repeat count falls out of the same grouping as a
 * one-time task's single completion, no special-casing needed. Each row
 * expands (the same native <details> the completed-tasks list already
 * uses) to the exact date and time of every occurrence, since that detail
 * is still there for whoever wants it - just not in the way of everyone
 * else's first glance at the totals.
 */
function PersonStatsSheet({
  name,
  breakdown,
  onTime,
  language,
  onClose,
}: {
  name: string
  breakdown: TaskBreakdown[]
  onTime: OnTimeRate | null
  language: Language
  onClose: () => void
}) {
  const { t } = useI18n()
  const totalCount = breakdown.reduce((sum, task) => sum + task.count, 0)
  const totalPoints = breakdown.reduce((sum, task) => sum + task.points, 0)

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <h2>{name}</h2>

        {onTime?.percent != null && (
          <p className="muted small">
            {onTime.percent}% {t.stats.onTimeLabel}
          </p>
        )}

        {breakdown.length === 0 ? (
          <p className="muted">{t.stats.breakdownEmpty}</p>
        ) : (
          <div className="stats-breakdown">
            <div className="stats-breakdown-row stats-breakdown-header">
              <span>{t.stats.columnTask}</span>
              <span>{t.stats.columnTimes}</span>
              <span>{t.stats.columnPoints}</span>
            </div>

            {breakdown.map((task) => (
              <details key={task.taskId} className="stats-breakdown-details">
                <summary className="stats-breakdown-row stats-breakdown-summary">
                  <span className="stats-breakdown-title">{task.title}</span>
                  <span>{task.count}</span>
                  <span>{task.points}</span>
                </summary>
                <ul className="history-list">
                  {task.timestamps.slice(0, MAX_TIMESTAMPS_SHOWN).map((iso, index) => (
                    <li key={index} className="history-row">
                      <span className="history-date">{formatDateTime(iso, language)}</span>
                    </li>
                  ))}
                </ul>
                {task.count > MAX_TIMESTAMPS_SHOWN && (
                  <p className="muted small">{t.stats.moreCompletions(task.count - MAX_TIMESTAMPS_SHOWN)}</p>
                )}
              </details>
            ))}

            <div className="stats-breakdown-row stats-breakdown-total">
              <span>{t.stats.total}</span>
              <span>{totalCount}</span>
              <span>{totalPoints}</span>
            </div>
          </div>
        )}

        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t.common.close}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Points, completion counts, and "who did what" for the current space. */
export function StatsScreen() {
  const { currentSpace, today, people, session, tasks } = useApp()
  const { t, language } = useI18n()
  const toast = useToast()
  const [completions, setCompletions] = useState<StatsCompletion[] | null>(null)
  const [memberIds, setMemberIds] = useState<string[] | null>(null)
  const [selected, setSelected] = useState<{ userId: string; name: string } | null>(null)

  useEffect(() => {
    if (!currentSpace) return
    let cancelled = false
    setCompletions(null)
    setMemberIds(null)
    Promise.all([api.fetchStatsCompletions(currentSpace.id), api.fetchMembers(currentSpace.id)])
      .then(([rows, members]) => {
        if (cancelled) return
        setCompletions(rows)
        setMemberIds(members.map((member) => member.user_id))
      })
      .catch((cause) => {
        toast.showError(cause)
        if (!cancelled) {
          setCompletions([])
          setMemberIds([])
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSpace?.id])

  const stats = useMemo(() => {
    if (!completions) return null

    const byPerson = new Map<string, { count: number; points: number }>()
    const byTask = new Map<string, { title: string; count: number }>()
    let last7Days = 0

    for (const row of completions) {
      const person = byPerson.get(row.user_id) ?? { count: 0, points: 0 }
      person.count += 1
      person.points += row.points_awarded
      byPerson.set(row.user_id, person)
    }

    // A completion credited to several people at once inserts one row per
    // person, all sharing completion_group - it happened once, so anything
    // counting physical events (not personal credit) counts that once too.
    const events = dedupeCompletionGroups(completions)
    for (const row of events) {
      const taskKey = row.task_id
      const task = byTask.get(taskKey) ?? { title: row.task?.title ?? '?', count: 0 }
      task.count += 1
      byTask.set(taskKey, task)

      if (daysBetween(row.completed_on, today) < 7) last7Days += 1
    }

    const leaderboard = [...byPerson.entries()].sort((a, b) => b[1].points - a[1].points)
    const topTask = [...byTask.values()].sort((a, b) => b.count - a.count)[0] ?? null
    // Points, not task count, so a hard task pulls its own weight - it can
    // be worth as much as several easy ones.
    const totalPoints = [...byPerson.values()].reduce((sum, entry) => sum + entry.points, 0)

    return { leaderboard, topTask, total: events.length, last7Days, totalPoints }
  }, [completions, today])

  // Each of these is independent of the others and of `stats` above - a
  // separate small computation over the same completions, rather than one
  // large block that would need re-reading as a whole to change any one of
  // them.
  const trend = useMemo(() => weeklyTrend(completions ?? [], today), [completions, today])
  const onTime = useMemo(() => onTimeRate(completions ?? []), [completions])
  const neglected = useMemo(() => mostNeglectedTask(completions ?? []), [completions])
  const busiestDay = useMemo(() => busiestWeekday(completions ?? []), [completions])
  const inactive = useMemo(
    () => inactiveMembers(memberIds ?? [], completions ?? [], today),
    [memberIds, completions, today],
  )
  const missedCycles = useMemo(
    () => missedCyclesSummary(completions ?? [], tasks, today),
    [completions, tasks, today],
  )

  const selectedBreakdown = useMemo<TaskBreakdown[]>(() => {
    if (!selected || !completions) return []
    const byTask = new Map<string, TaskBreakdown>()
    for (const row of completions) {
      if (row.user_id !== selected.userId) continue
      const entry = byTask.get(row.task_id) ?? {
        taskId: row.task_id,
        title: row.task?.title ?? '?',
        count: 0,
        points: 0,
        timestamps: [],
      }
      entry.count += 1
      entry.points += row.points_awarded
      entry.timestamps.push(row.created_at)
      byTask.set(row.task_id, entry)
    }
    return [...byTask.values()]
      .map((entry) => ({ ...entry, timestamps: [...entry.timestamps].sort((a, b) => b.localeCompare(a)) }))
      .sort((a, b) => b.points - a.points)
  }, [completions, selected])

  const selectedOnTime = useMemo(() => {
    if (!selected || !completions) return null
    return onTimeRate(completions.filter((row) => row.user_id === selected.userId))
  }, [completions, selected])

  function personName(userId: string): string {
    if (userId === session?.user.id) return t.space.you
    const person = people.get(userId)
    return person?.display_name || person?.email || t.task.someoneElse
  }

  if (!currentSpace) return null

  return (
    <div className="screen fade-in">
      <header className="screen-header">
        <h2>{t.stats.title}</h2>
      </header>

      {!stats ? (
        <p className="muted">{t.common.loading}</p>
      ) : stats.total === 0 && missedCycles.total === 0 ? (
        // A recurring task can rack up missed cycles while sitting untouched,
        // with zero completions ever logged for it - that is itself the
        // finding this screen exists to surface, not a reason to hide behind
        // the empty state meant for a genuinely blank history.
        <div className="empty-state">
          <ChartIcon size={40} />
          <p>{t.stats.noData}</p>
        </div>
      ) : (
        <>
          <section className="card">
            <h3>{t.stats.byPerson}</h3>
            <ul className="leaderboard">
              {stats.leaderboard.map(([userId, entry], index) => {
                const name = personName(userId)
                // How much of the household's total effort this person
                // contributed, weighted by points rather than task count -
                // only meaningful to show once there is someone to compare
                // against.
                const share = stats.totalPoints > 0 ? Math.round((entry.points / stats.totalPoints) * 100) : 0
                return (
                  <li key={userId} className="leaderboard-row">
                    <button
                      type="button"
                      className="leaderboard-row-button"
                      onClick={() => setSelected({ userId, name })}
                      aria-label={t.stats.breakdownAria(name)}
                    >
                      <span className="leaderboard-rank">{index + 1}</span>
                      <span className="leaderboard-name">{name}</span>
                      <span className="leaderboard-points">
                        <StarIcon size={13} /> {entry.points}
                      </span>
                      <span className="muted small">{t.stats.completionsCount(entry.count)}</span>
                      {stats.leaderboard.length > 1 && (
                        <div className="contribution-bar">
                          <div className="contribution-track" aria-hidden="true">
                            <div className="contribution-fill" style={{ width: `${share}%` }} />
                          </div>
                          <span className="contribution-share">{share}%</span>
                        </div>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="card stat-tiles">
            <div className="stat-tile">
              <span className="points-value">{stats.total}</span>
              <span className="points-label">{t.stats.allTime}</span>
            </div>
            <div className="stat-tile">
              <span className="points-value">{stats.last7Days}</span>
              <span className="points-label">{t.stats.last7Days}</span>
            </div>
            {onTime.percent != null && (
              <div className="stat-tile">
                <span className="points-value">{onTime.percent}%</span>
                <span className="points-label">{t.stats.onTimeLabel}</span>
              </div>
            )}
          </section>

          <section className="card">
            <h3>{t.stats.weeklyTrendTitle}</h3>
            <div className="stats-breakdown">
              <div className="stats-breakdown-row stats-breakdown-header">
                <span></span>
                <span>{t.stats.columnTimes}</span>
                <span>{t.stats.columnPoints}</span>
              </div>
              {trend.map((week) => (
                <div key={week.weeksAgo} className="stats-breakdown-row">
                  <span>{t.stats.weeksAgoLabel(week.weeksAgo)}</span>
                  <span>{week.count}</span>
                  <span>{week.points}</span>
                </div>
              ))}
            </div>
          </section>

          {stats.topTask && (
            <section className="card">
              <h3>{t.stats.topTask}</h3>
              <p className="muted">{stats.topTask.title} · {t.stats.completionsCount(stats.topTask.count)}</p>
            </section>
          )}

          {neglected && (
            <section className="card">
              <h3>{t.stats.neglectedTaskTitle}</h3>
              <p className="muted">{t.stats.neglectedTaskBody(neglected.title, neglected.avgDaysLate)}</p>
            </section>
          )}

          {missedCycles.total > 0 && (
            <section className="card">
              <h3>{t.stats.missedCyclesTitle}</h3>
              <p className="muted">{t.stats.missedCyclesTotal(missedCycles.total)}</p>
              <ul className="history-list">
                {missedCycles.byTask.map((entry) => (
                  <li key={entry.taskId} className="history-row">
                    <span>{entry.title}</span>
                    <span className="muted small">{cyclesWord(entry.missed, language)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {busiestDay && (
            <section className="card">
              <h3>{t.stats.busiestDayTitle}</h3>
              <p className="muted">{t.stats.busiestDayBody(weekdayName(busiestDay.weekday, language), busiestDay.count)}</p>
            </section>
          )}

          {inactive.length > 0 && (
            <section className="card">
              <h3>{t.stats.inactiveTitle}</h3>
              <ul className="history-list">
                {inactive.map((entry) => (
                  <li key={entry.userId} className="history-row">
                    <span>{personName(entry.userId)}</span>
                    <span className="muted small">
                      {entry.daysSinceLastCompletion == null
                        ? t.stats.neverActive
                        : t.stats.inactiveDays(entry.daysSinceLastCompletion)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {selected && (
        <PersonStatsSheet
          name={selected.name}
          breakdown={selectedBreakdown}
          onTime={selectedOnTime}
          language={language}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
