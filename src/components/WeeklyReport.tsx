import { useEffect, useMemo, useState } from 'react'
import * as api from '../lib/api'
import type { StatsCompletion } from '../lib/api'
import { formatWeekRange, weekdayShort } from '../lib/format'
import { useI18n, type Language } from '../lib/i18n'
import { addDays, todayIn } from '../lib/taskDue'
import type { RewardRedemption } from '../lib/types'
import { buildWeeklyReport, latestWeekEnd, reportSince, type DayStatus, type WeeklyReport as Report } from '../lib/weeklyReport'
import { useApp } from '../state/AppState'

const DAY_ICON: Record<DayStatus, string> = { closed: '✓', broken: '!', open: '…', future: '', none: '' }

function weekdayLong(isoDate: string, language: Language): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(language === 'he' ? 'he-IL' : 'en-GB', { weekday: 'long', timeZone: 'UTC' })
}

/** The week the report can go up to: the one running now, ending this Saturday. */
export function lastReportableWeek(today: string): string {
  const end = latestWeekEnd(today)
  return end === today ? end : addDays(end, 7)
}

/**
 * One household's week, Sunday through Saturday - what the Saturday-evening
 * notification opens on, and what the Stats screen's "weekly report" shows.
 * Everything comes from rows the Stats screen already loaded, plus the
 * space's reward redemptions.
 */
export function WeeklyReport({
  weekEnd,
  completions,
  skips,
  onWeekChange,
  onClose,
}: {
  weekEnd: string
  completions: StatsCompletion[] | null
  skips: { task_id: string; skipped_on: string; prev_due_date: string }[]
  onWeekChange: (weekEnd: string) => void
  onClose: () => void
}) {
  const { currentSpace, tasks, today, people, session, profile, isPaused } = useApp()
  const { t, language } = useI18n()
  const [redemptions, setRedemptions] = useState<RewardRedemption[]>([])
  const selfId = session?.user.id ?? null
  const timezone = profile?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone

  useEffect(() => {
    if (!currentSpace) return
    let cancelled = false
    api
      .fetchRedemptions(currentSpace.id)
      .then((rows) => {
        if (!cancelled) setRedemptions(rows)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [currentSpace])

  const report: Report | null = useMemo(() => {
    if (!completions || !currentSpace) return null
    const spaceTasks = tasks.filter((task) => task.space_id === currentSpace.id)
    const firstTask = spaceTasks.map((task) => todayIn(timezone, new Date(task.created_at))).sort()[0] ?? today
    const since = reportSince(firstTask, completions, skips)
    return buildWeeklyReport({ tasks: spaceTasks, completions, skips, redemptions, weekEnd, today, since, timezone, isPaused })
  }, [completions, skips, redemptions, tasks, currentSpace, weekEnd, today, timezone, isPaused])

  const name = (userId: string) =>
    userId === selfId ? t.report.you : people.get(userId)?.display_name || people.get(userId)?.email || '?'
  const lastWeek = lastReportableWeek(today)
  const running = weekEnd > today

  return (
    <div className="screen fade-in weekly-report">
      <header className="screen-header subpage-header">
        <button type="button" className="back-button" onClick={onClose}>
          {t.report.back}
        </button>
        <h1>{t.report.title}</h1>
        <div className="report-week-nav">
          <button
            type="button"
            className="report-week-arrow report-week-prev"
            onClick={() => onWeekChange(addDays(weekEnd, -7))}
            aria-label={t.report.prevWeek}
          />
          <p className="screen-subtitle">
            {currentSpace?.name} · {formatWeekRange(addDays(weekEnd, -6), weekEnd, language)}
            {running && <span className="report-running"> · {t.report.running}</span>}
          </p>
          <button
            type="button"
            className="report-week-arrow report-week-next"
            onClick={() => onWeekChange(addDays(weekEnd, 7))}
            disabled={weekEnd >= lastWeek}
            aria-label={t.report.nextWeek}
          />
        </div>
      </header>

      {!report ? (
        <p className="muted">{t.common.loading}</p>
      ) : (
        <>
          <section className="report-kpis">
            <Kpi value={String(report.figures.done)} label={t.report.done} delta={report.figures.done - report.previous.done} />
            <Kpi value={String(report.figures.points)} label={t.report.points} delta={report.figures.points - report.previous.points} />
            <Kpi
              value={report.figures.onTime === null ? '–' : `${report.figures.onTime}%`}
              label={t.report.onTime}
              delta={report.figures.onTime !== null && report.previous.onTime !== null ? report.figures.onTime - report.previous.onTime : null}
              unit="%"
            />
            <Kpi value={`${report.daysClosed}/${report.daysCounted}`} label={t.report.closedDays} delta={null} />
          </section>

          {report.figures.done === 0 && report.missed.length === 0 && <p className="muted report-quiet">{t.report.quiet}</p>}

          <section className="card">
            <h3>{t.report.byDay}</h3>
            <DayChart report={report} />
          </section>

          {report.people.length > 0 && (
            <section className="card">
              <h3>{t.report.people}</h3>
              <ul className="report-people">
                {report.people.map((person, index) => (
                  <li key={person.userId} className={person.userId === selfId ? 'report-person report-person-self' : 'report-person'}>
                    <div className="report-person-head">
                      <span className="report-person-name">{name(person.userId)}</span>
                      {index === 0 && report.people.length > 1 && person.points > 0 && <span className="chip">{t.report.leader}</span>}
                      <span className="report-person-points">{t.report.pointsCost(person.points)}</span>
                    </div>
                    <p className="muted small">
                      {t.report.personLine(person.done, person.together)}
                      {person.onTime !== null && ` · ${t.report.personOnTime(person.onTime)}`}
                    </p>
                    <div className="report-meter" aria-hidden="true">
                      <div className="report-meter-fill" style={{ width: `${person.share}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <TimingCard report={report} />

          <section className="card">
            <h3>{t.report.highlights}</h3>
            <ul className="report-list">
              {report.topTask && (
                <li>
                  <span>
                    {t.report.mostDone}: <b>{report.topTask.title}</b>
                  </span>
                  <span className="muted">{t.report.times(report.topTask.done)}</span>
                </li>
              )}
              {report.missed.map((entry) => (
                <li key={entry.taskId} className="report-list-late">
                  <span>
                    {t.report.missedLabel}: <b>{entry.title}</b>
                  </span>
                  <span>{t.report.cycles(entry.cycles)}</span>
                </li>
              ))}
              {report.overdueNow.map((entry) => (
                <li key={entry.taskId}>
                  <span>
                    {t.report.lateNow}: <b>{entry.title}</b>
                  </span>
                  <span className="muted">{t.report.daysLate(entry.daysLate)}</span>
                </li>
              ))}
              {report.missed.length === 0 && report.overdueNow.length === 0 && <li className="muted">{t.report.nothingNotable}</li>}
            </ul>
          </section>

          <section className="card">
            <h3>{t.report.streakTitle}</h3>
            <p className="report-streak">{t.report.streakDays(report.streak)}</p>
            <p className="muted small">{report.brokeOn ? t.report.brokeOn(weekdayLong(report.brokeOn, language)) : t.report.unbroken}</p>
          </section>

          <section className="card">
            <h3>{t.report.rewards}</h3>
            {report.redeemed.length === 0 && report.pending.length === 0 ? (
              <p className="muted">{t.report.noRewards}</p>
            ) : (
              <ul className="report-list">
                {report.redeemed.map((entry, i) => (
                  <li key={`r${i}`}>
                    <span>
                      {t.report.redeemed}: <b>{entry.title}</b> · {name(entry.by)}
                    </span>
                    <span className="muted">{t.report.pointsCost(entry.cost)}</span>
                  </li>
                ))}
                {report.pending.map((entry, i) => (
                  <li key={`p${i}`}>
                    <span>
                      {t.report.pending}: <b>{entry.title}</b> · {name(entry.by)}
                    </span>
                    <span className="muted">{t.report.pointsCost(entry.cost)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function Kpi({ value, label, delta, unit = '' }: { value: string; label: string; delta: number | null; unit?: string }) {
  const { t } = useI18n()
  return (
    <div className="report-kpi">
      <span className="report-kpi-value">{value}</span>
      <span className="report-kpi-label">{label}</span>
      {delta !== null && (
        <span className={`report-delta ${delta > 0 ? 'report-delta-up' : delta < 0 ? 'report-delta-down' : ''}`}>
          {delta === 0 ? t.report.same : delta > 0 ? t.report.up(`${delta}${unit}`) : t.report.down(`${-delta}${unit}`)}
        </span>
      )}
    </div>
  )
}

function DayChart({ report }: { report: Report }) {
  const { t, language } = useI18n()
  const max = Math.max(1, ...report.days.map((day) => day.done))
  return (
    <ul className="report-days">
      {report.days.map((day) => {
        const weekday = weekdayShort(new Date(`${day.date}T00:00:00Z`).getUTCDay(), language)
        const status = t.report.dayStatus[day.status]
        return (
          <li key={day.date} className={`report-day report-day-${day.status}`} aria-label={t.report.dayAria(weekdayLong(day.date, language), day.done, status)}>
            <span className="report-day-count" aria-hidden="true">
              {day.status === 'future' ? '' : day.done}
            </span>
            <span className="report-day-track" aria-hidden="true">
              <span className="report-day-bar" style={{ height: `${(day.done / max) * 100}%` }} />
            </span>
            <span className="report-day-mark" aria-hidden="true">
              {DAY_ICON[day.status]}
            </span>
            <span className="report-day-label" aria-hidden="true">
              {weekday}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function TimingCard({ report }: { report: Report }) {
  const { t } = useI18n()
  const total = report.timing.early + report.timing.onTime + report.timing.late + report.timing.skipped + report.timing.missed
  if (total === 0) return null
  return (
    <section className="card">
      <h3>{t.stats.timingTitle}</h3>
      <ul className="timing-list">
        {(['early', 'onTime', 'late', 'skipped', 'missed'] as const).map((kind) => (
          <li key={kind} className={`timing-row timing-${kind}`}>
            <span>{t.stats.timing[kind]}</span>
            <div className="timing-track" aria-hidden="true">
              <div className="timing-fill" style={{ width: `${Math.round((report.timing[kind] / total) * 100)}%` }} />
            </div>
            <span className="timing-count">{report.timing[kind]}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
