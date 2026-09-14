import { useEffect, useMemo, useState } from 'react'
import * as api from '../lib/api'
import { daysBetween } from '../lib/taskDue'
import { useI18n } from '../lib/i18n'
import { useApp } from '../state/AppState'
import { useToast } from './Toast'
import { ChartIcon, StarIcon } from './Icons'
import type { StatsCompletion } from '../lib/api'

/** Points, completion counts, and "who did what" for the current space. */
export function StatsScreen() {
  const { currentSpace, today, people, session } = useApp()
  const { t } = useI18n()
  const toast = useToast()
  const [completions, setCompletions] = useState<StatsCompletion[] | null>(null)

  useEffect(() => {
    if (!currentSpace) return
    let cancelled = false
    setCompletions(null)
    api
      .fetchStatsCompletions(currentSpace.id)
      .then((rows) => {
        if (!cancelled) setCompletions(rows)
      })
      .catch((cause) => {
        toast.showError(cause)
        if (!cancelled) setCompletions([])
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
    // A completion credited to several people at once inserts one row per
    // person, all sharing completion_group - it happened once, so it must
    // only count once here, however many people were credited for it.
    const seenGroups = new Set<string>()
    let total = 0
    let last7Days = 0

    for (const row of completions) {
      const person = byPerson.get(row.user_id) ?? { count: 0, points: 0 }
      person.count += 1
      person.points += row.points_awarded
      byPerson.set(row.user_id, person)

      const isNewEvent = !row.completion_group || !seenGroups.has(row.completion_group)
      if (row.completion_group) seenGroups.add(row.completion_group)
      if (!isNewEvent) continue

      total += 1
      const taskKey = row.task_id
      const task = byTask.get(taskKey) ?? { title: row.task?.title ?? '?', count: 0 }
      task.count += 1
      byTask.set(taskKey, task)

      if (daysBetween(row.completed_on, today) < 7) last7Days += 1
    }

    const leaderboard = [...byPerson.entries()].sort((a, b) => b[1].points - a[1].points)
    const topTask = [...byTask.values()].sort((a, b) => b.count - a.count)[0] ?? null

    return { leaderboard, topTask, total, last7Days }
  }, [completions, today])

  if (!currentSpace) return null

  return (
    <div className="screen fade-in">
      <header className="screen-header">
        <h2>{t.stats.title}</h2>
      </header>

      {!stats ? (
        <p className="muted">{t.common.loading}</p>
      ) : stats.total === 0 ? (
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
                const person = people.get(userId)
                const name =
                  userId === session?.user.id
                    ? t.space.you
                    : person?.display_name || person?.email || t.task.someoneElse
                return (
                  <li key={userId} className="leaderboard-row">
                    <span className="leaderboard-rank">{index + 1}</span>
                    <span className="leaderboard-name">{name}</span>
                    <span className="leaderboard-points">
                      <StarIcon size={13} /> {entry.points}
                    </span>
                    <span className="muted small">{t.stats.completionsCount(entry.count)}</span>
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="card two-tiles">
            <div className="stat-tile">
              <span className="points-value">{stats.total}</span>
              <span className="points-label">{t.stats.allTime}</span>
            </div>
            <div className="stat-tile">
              <span className="points-value">{stats.last7Days}</span>
              <span className="points-label">{t.stats.last7Days}</span>
            </div>
          </section>

          {stats.topTask && (
            <section className="card">
              <h3>{t.stats.topTask}</h3>
              <p className="muted">{stats.topTask.title} · {t.stats.completionsCount(stats.topTask.count)}</p>
            </section>
          )}
        </>
      )}
    </div>
  )
}
