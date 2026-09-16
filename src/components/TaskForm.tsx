import { useEffect, useState } from 'react'
import { addDays } from '../lib/taskDue'
import { errorMessage } from '../lib/errors'
import { formatDate, weekdayShort } from '../lib/format'
import { useI18n } from '../lib/i18n'
import { toDatetimeLocalValue } from '../lib/snoozeOptions'
import type { EndCondition, RecurrenceMode, TaskType } from '../lib/taskDue'
import type { Member, ReminderPolicy, ReminderPolicyMode, Task } from '../lib/types'

export interface TaskDraft {
  title: string
  description: string
  taskType: TaskType
  recurrenceMode: RecurrenceMode | null
  intervalDays: number
  weeklyDays: number[]
  endCondition: EndCondition
  endAfterCount: number
  endDate: string
  points: number
  reminderHour: number
  reminderMinute: number
  dueDate: string
  assignedTo: string
  /** Only meaningful when taskType is 'time_limited'. */
  startsAt: string | null
  expiresAt: string | null
  reminderPolicy: ReminderPolicy | null
}

interface TaskFormProps {
  today: string
  existing?: Task
  /** Pre-fills every field from an expired/cancelled task, the same as
   *  editing would - but onSave still creates a new task, since the old
   *  window has passed and there is nothing left to update. */
  duplicateFrom?: Task
  members: Member[]
  onCancel: () => void
  onSave: (draft: TaskDraft) => Promise<void>
  onDelete?: () => Promise<void>
}

const INTERVAL_PRESETS = [1, 7, 14, 30]
const REMINDER_MINUTE_PRESETS = [15, 30, 60]
const REMINDER_HOUR_PRESETS = [1, 2, 4, 6, 12]
const REMINDER_DAILY_INTERVAL_PRESETS = [1, 2, 3, 7]

/** A little in the future, so a fresh window never opens pre-filled with an
 *  end time that already reads as invalid. */
function defaultWindowStart(): string {
  return toDatetimeLocalValue(new Date(Date.now() + 15 * 60_000))
}
function defaultWindowEnd(): string {
  return toDatetimeLocalValue(new Date(Date.now() + 3 * 60 * 60_000))
}

/** `datetime-local` reads and writes local wall-clock fields with no
 *  timezone suffix - this converts a stored ISO instant into that same
 *  shape, the way SnoozeSheet's custom time field already does. */
function toLocalInput(iso: string | null): string {
  return iso ? toDatetimeLocalValue(new Date(iso)) : ''
}

export function TaskForm({ today, existing, duplicateFrom, members, onCancel, onSave, onDelete }: TaskFormProps) {
  const { t, language } = useI18n()
  const source = existing ?? duplicateFrom

  const [title, setTitle] = useState(source?.title ?? '')
  const [description, setDescription] = useState(source?.description ?? '')
  const [taskType, setTaskType] = useState<TaskType>(source?.task_type ?? 'recurring')
  const [recurrenceMode, setRecurrenceMode] = useState<RecurrenceMode>(
    source?.recurrence_mode ?? 'interval',
  )
  const [intervalDays, setIntervalDays] = useState(source?.interval_days ?? 7)
  const [weeklyDays, setWeeklyDays] = useState<number[]>(source?.weekly_days ?? [])
  const [endCondition, setEndCondition] = useState<EndCondition>(source?.end_condition ?? 'never')
  const [endAfterCount, setEndAfterCount] = useState(source?.end_after_count ?? 10)
  const [endDate, setEndDate] = useState(source?.end_date ?? addDays(today, 30))
  const [points, setPoints] = useState(source?.points ?? 10)
  const [reminderHour, setReminderHour] = useState(source?.reminder_hour ?? 9)
  const [reminderMinute, setReminderMinute] = useState(source?.reminder_minute ?? 0)
  // New task defaults to "due today", which is almost always what is meant
  // when adding one in the moment.
  const [dueDate, setDueDate] = useState(source?.due_date ?? today)
  const [assignedTo, setAssignedTo] = useState(source?.assigned_to ?? '')
  const [startsAt, setStartsAt] = useState(() => toLocalInput(source?.starts_at ?? null) || defaultWindowStart())
  const [expiresAt, setExpiresAt] = useState(() => toLocalInput(source?.expires_at ?? null) || defaultWindowEnd())
  const [reminderMode, setReminderMode] = useState<ReminderPolicyMode>(
    source?.reminder_policy?.mode ?? 'interval',
  )
  const [intervalUnit, setIntervalUnit] = useState<'minutes' | 'hours'>(
    source?.reminder_policy?.intervalUnit ?? 'minutes',
  )
  const [reminderIntervalValue, setReminderIntervalValue] = useState(() => {
    const storedMinutes = source?.reminder_policy?.intervalMinutes ?? 30
    return source?.reminder_policy?.intervalUnit === 'hours' ? storedMinutes / 60 : storedMinutes
  })
  const [dailyIntervalDays, setDailyIntervalDays] = useState(source?.reminder_policy?.dailyIntervalDays ?? 1)
  const [dailyHour, setDailyHour] = useState(source?.reminder_policy?.dailyHour ?? 9)
  const [dailyMinute, setDailyMinute] = useState(source?.reminder_policy?.dailyMinute ?? 0)
  const [finalReminderEnabled, setFinalReminderEnabled] = useState(
    source?.reminder_policy?.finalReminderMinutesBeforeExpiry != null,
  )
  const [finalReminderMinutes, setFinalReminderMinutes] = useState(
    source?.reminder_policy?.finalReminderMinutesBeforeExpiry ?? 15,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.getElementById('task-title')?.focus()
  }, [])

  function toggleWeekday(day: number) {
    setWeeklyDays((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort((a, b) => a - b),
    )
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim()) return setError(t.taskForm.errorNoName)
    if (!Number.isInteger(points) || points < 1 || points > 1000) return setError(t.taskForm.errorPoints)
    if (taskType === 'recurring') {
      if (recurrenceMode === 'interval' && (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 365)) {
        return setError(t.taskForm.errorInterval)
      }
      if (recurrenceMode === 'weekly_days' && weeklyDays.length === 0) {
        return setError(t.taskForm.errorWeeklyDays)
      }
      if (endCondition === 'after_count' && (!Number.isInteger(endAfterCount) || endAfterCount < 1)) {
        return setError(t.taskForm.errorEndAfterCount)
      }
      if (endCondition === 'on_date' && endDate <= dueDate) {
        return setError(t.taskForm.errorEndDate)
      }
    }
    if (taskType === 'time_limited') {
      if (!startsAt || !expiresAt || new Date(expiresAt) <= new Date(startsAt)) {
        return setError(t.taskForm.errorWindowOrder)
      }
      if (reminderMode === 'interval' && intervalUnit === 'minutes') {
        if (!Number.isInteger(reminderIntervalValue) || reminderIntervalValue < 5 || reminderIntervalValue > 1440) {
          return setError(t.taskForm.errorReminderIntervalMinutes)
        }
      }
      if (reminderMode === 'interval' && intervalUnit === 'hours') {
        if (!Number.isInteger(reminderIntervalValue) || reminderIntervalValue < 1 || reminderIntervalValue > 72) {
          return setError(t.taskForm.errorReminderIntervalHours)
        }
      }
      if (
        reminderMode === 'daily' &&
        (!Number.isInteger(dailyIntervalDays) || dailyIntervalDays < 1 || dailyIntervalDays > 30)
      ) {
        return setError(t.taskForm.errorReminderDaily)
      }
      if (
        finalReminderEnabled &&
        (!Number.isInteger(finalReminderMinutes) || finalReminderMinutes < 1 || finalReminderMinutes > 1440)
      ) {
        return setError(t.taskForm.errorFinalReminder)
      }
    }

    const reminderPolicy: ReminderPolicy | null =
      taskType === 'time_limited'
        ? {
            mode: reminderMode,
            intervalMinutes:
              reminderMode === 'interval'
                ? intervalUnit === 'hours'
                  ? reminderIntervalValue * 60
                  : reminderIntervalValue
                : null,
            intervalUnit: reminderMode === 'interval' ? intervalUnit : null,
            dailyIntervalDays: reminderMode === 'daily' ? dailyIntervalDays : null,
            dailyHour: reminderMode === 'daily' ? dailyHour : null,
            dailyMinute: reminderMode === 'daily' ? dailyMinute : null,
            finalReminderMinutesBeforeExpiry: finalReminderEnabled ? finalReminderMinutes : null,
          }
        : null

    setBusy(true)
    setError(null)
    try {
      await onSave({
        title,
        description,
        taskType,
        recurrenceMode: taskType === 'recurring' ? recurrenceMode : null,
        intervalDays,
        weeklyDays,
        endCondition: taskType === 'recurring' ? endCondition : 'never',
        endAfterCount,
        endDate,
        points,
        reminderHour,
        reminderMinute,
        dueDate,
        assignedTo,
        startsAt: taskType === 'time_limited' ? new Date(startsAt).toISOString() : null,
        expiresAt: taskType === 'time_limited' ? new Date(expiresAt).toISOString() : null,
        reminderPolicy,
      })
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onCancel} role="presentation">
      <form
        className="sheet"
        onClick={(event) => event.stopPropagation()}
        onSubmit={save}
        aria-label={existing ? t.taskForm.titleEdit : t.taskForm.titleNew}
      >
        <h2>{existing ? t.taskForm.titleEdit : t.taskForm.titleNew}</h2>

        <label className="field">
          <span>{t.taskForm.name}</span>
          <input
            id="task-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t.taskForm.namePlaceholder}
            maxLength={80}
            autoComplete="off"
          />
        </label>

        <label className="field">
          <span>{t.taskForm.description}</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t.taskForm.descriptionPlaceholder}
            maxLength={2000}
            rows={4}
          />
        </label>

        <fieldset className="field">
          <legend>{t.taskForm.type}</legend>
          <div className="segmented">
            <button
              type="button"
              className={taskType === 'one_time' ? 'segment segment-active' : 'segment'}
              onClick={() => setTaskType('one_time')}
            >
              {t.taskForm.typeOneTime}
            </button>
            <button
              type="button"
              className={taskType === 'recurring' ? 'segment segment-active' : 'segment'}
              onClick={() => setTaskType('recurring')}
            >
              {t.taskForm.typeRecurring}
            </button>
            <button
              type="button"
              className={taskType === 'time_limited' ? 'segment segment-active' : 'segment'}
              onClick={() => setTaskType('time_limited')}
            >
              {t.taskForm.typeTimeLimited}
            </button>
          </div>
        </fieldset>

        {taskType === 'time_limited' && (
          <>
            <label className="field">
              <span>{t.taskForm.windowStart}</span>
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
              />
            </label>
            <label className="field">
              <span>{t.taskForm.windowEnd}</span>
              <input
                type="datetime-local"
                value={expiresAt}
                min={startsAt}
                onChange={(event) => setExpiresAt(event.target.value)}
              />
            </label>

            <fieldset className="field">
              <legend>{t.taskForm.reminderPolicy}</legend>
              <div className="segmented segmented-wrap">
                <button
                  type="button"
                  className={reminderMode === 'none' ? 'segment segment-active' : 'segment'}
                  onClick={() => setReminderMode('none')}
                >
                  {t.taskForm.reminderPolicyNone}
                </button>
                <button
                  type="button"
                  className={reminderMode === 'start_only' ? 'segment segment-active' : 'segment'}
                  onClick={() => setReminderMode('start_only')}
                >
                  {t.taskForm.reminderPolicyStartOnly}
                </button>
                <button
                  type="button"
                  className={reminderMode === 'interval' || reminderMode === 'daily' ? 'segment segment-active' : 'segment'}
                  onClick={() => setReminderMode('interval')}
                >
                  {t.taskForm.reminderPolicyInterval}
                </button>
              </div>

              {(reminderMode === 'interval' || reminderMode === 'daily') && (
                <>
                  <div className="segmented">
                    <button
                      type="button"
                      className={reminderMode === 'interval' && intervalUnit === 'minutes' ? 'segment segment-active' : 'segment'}
                      onClick={() => {
                        setReminderMode('interval')
                        setIntervalUnit('minutes')
                        setReminderIntervalValue(30)
                      }}
                    >
                      {t.taskForm.minutesUnit}
                    </button>
                    <button
                      type="button"
                      className={reminderMode === 'interval' && intervalUnit === 'hours' ? 'segment segment-active' : 'segment'}
                      onClick={() => {
                        setReminderMode('interval')
                        setIntervalUnit('hours')
                        setReminderIntervalValue(2)
                      }}
                    >
                      {t.taskForm.hoursUnit}
                    </button>
                    <button
                      type="button"
                      className={reminderMode === 'daily' ? 'segment segment-active' : 'segment'}
                      onClick={() => setReminderMode('daily')}
                    >
                      {t.taskForm.intervalUnit}
                    </button>
                  </div>

                  {reminderMode === 'interval' && (
                    <>
                      <div className="preset-row">
                        {(intervalUnit === 'minutes' ? REMINDER_MINUTE_PRESETS : REMINDER_HOUR_PRESETS).map((n) => (
                          <button
                            key={n}
                            type="button"
                            className={reminderIntervalValue === n ? 'preset preset-active' : 'preset'}
                            onClick={() => setReminderIntervalValue(n)}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                      <div className="inline-field">
                        <input
                          type="number"
                          min={intervalUnit === 'minutes' ? 5 : 1}
                          max={intervalUnit === 'minutes' ? 1440 : 72}
                          value={reminderIntervalValue}
                          onChange={(event) => setReminderIntervalValue(Number(event.target.value))}
                          aria-label={t.taskForm.reminderIntervalAria}
                        />
                        <span>{intervalUnit === 'minutes' ? t.taskForm.minutesUnit : t.taskForm.hoursUnit}</span>
                      </div>
                    </>
                  )}

                  {reminderMode === 'daily' && (
                    <>
                      <div className="preset-row">
                        {REMINDER_DAILY_INTERVAL_PRESETS.map((n) => (
                          <button
                            key={n}
                            type="button"
                            className={dailyIntervalDays === n ? 'preset preset-active' : 'preset'}
                            onClick={() => setDailyIntervalDays(n)}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                      <div className="inline-field">
                        <input
                          type="number"
                          min={1}
                          max={30}
                          value={dailyIntervalDays}
                          onChange={(event) => setDailyIntervalDays(Number(event.target.value))}
                          aria-label={t.taskForm.reminderDailyIntervalAria}
                        />
                        <span>{t.taskForm.intervalUnit}</span>
                      </div>
                      <label className="field">
                        <span>{t.taskForm.reminderDailyTimeLabel}</span>
                        <input
                          type="time"
                          value={`${String(dailyHour).padStart(2, '0')}:${String(dailyMinute).padStart(2, '0')}`}
                          onChange={(event) => {
                            const [h, m] = event.target.value.split(':').map(Number)
                            if (Number.isFinite(h) && Number.isFinite(m)) {
                              setDailyHour(h)
                              setDailyMinute(m)
                            }
                          }}
                          aria-label={t.taskForm.reminderDailyTimeAria}
                        />
                      </label>
                    </>
                  )}
                </>
              )}
            </fieldset>

            <label className="field">
              <span className="inline-field">
                <input
                  type="checkbox"
                  checked={finalReminderEnabled}
                  onChange={(event) => setFinalReminderEnabled(event.target.checked)}
                />
                {t.taskForm.finalReminderToggle}
              </span>
              {finalReminderEnabled && (
                <div className="inline-field">
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={finalReminderMinutes}
                    onChange={(event) => setFinalReminderMinutes(Number(event.target.value))}
                    aria-label={t.taskForm.finalReminderAria}
                  />
                  <span>{t.taskForm.minutesBeforeEnd}</span>
                </div>
              )}
            </label>
          </>
        )}

        {taskType === 'recurring' && (
          <>
            <fieldset className="field">
              <legend>{t.taskForm.recurrenceMode}</legend>
              <div className="segmented">
                <button
                  type="button"
                  className={recurrenceMode === 'interval' ? 'segment segment-active' : 'segment'}
                  onClick={() => setRecurrenceMode('interval')}
                >
                  {t.taskForm.modeInterval}
                </button>
                <button
                  type="button"
                  className={recurrenceMode === 'weekly_days' ? 'segment segment-active' : 'segment'}
                  onClick={() => setRecurrenceMode('weekly_days')}
                >
                  {t.taskForm.modeWeekly}
                </button>
              </div>
            </fieldset>

            {recurrenceMode === 'interval' ? (
              <fieldset className="field">
                <legend>{t.taskForm.intervalLabel}</legend>
                <div className="preset-row">
                  {INTERVAL_PRESETS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={intervalDays === n ? 'preset preset-active' : 'preset'}
                      onClick={() => setIntervalDays(n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <div className="inline-field">
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={intervalDays}
                    onChange={(event) => setIntervalDays(Number(event.target.value))}
                    aria-label={t.taskForm.intervalAria}
                  />
                  <span>{t.taskForm.intervalUnit}</span>
                </div>
              </fieldset>
            ) : (
              <fieldset className="field">
                <legend>{t.taskForm.weeklyDaysLabel}</legend>
                <div className="weekday-row">
                  {[0, 1, 2, 3, 4, 5, 6].map((day) => (
                    <button
                      key={day}
                      type="button"
                      className={weeklyDays.includes(day) ? 'weekday weekday-active' : 'weekday'}
                      onClick={() => toggleWeekday(day)}
                    >
                      {weekdayShort(day, language)}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            <fieldset className="field">
              <legend>{t.taskForm.endCondition}</legend>
              <div className="segmented segmented-wrap end-condition">
                <button
                  type="button"
                  className={endCondition === 'never' ? 'segment segment-active' : 'segment'}
                  onClick={() => setEndCondition('never')}
                >
                  {t.taskForm.endNever}
                </button>
                <button
                  type="button"
                  className={endCondition === 'after_count' ? 'segment segment-active' : 'segment'}
                  onClick={() => setEndCondition('after_count')}
                >
                  {t.taskForm.endAfterCount}
                </button>
                <button
                  type="button"
                  className={endCondition === 'on_date' ? 'segment segment-active' : 'segment'}
                  onClick={() => setEndCondition('on_date')}
                >
                  {t.taskForm.endOnDate}
                </button>
              </div>
              {endCondition === 'after_count' && (
                <label className="inline-field">
                  <span>{t.taskForm.endAfterCountLabel}</span>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={endAfterCount}
                    onChange={(event) => setEndAfterCount(Number(event.target.value))}
                  />
                </label>
              )}
              {endCondition === 'on_date' && (
                <label className="field">
                  <span>{t.taskForm.endDateLabel}</span>
                  <input
                    type="date"
                    value={endDate}
                    min={addDays(dueDate, 1)}
                    onChange={(event) => setEndDate(event.target.value)}
                  />
                </label>
              )}
            </fieldset>
          </>
        )}

        <div className="two-col">
          <label className="field">
            <span>{t.taskForm.points}</span>
            <div className="inline-field">
              <input
                type="number"
                min={1}
                max={1000}
                value={points}
                onChange={(event) => setPoints(Number(event.target.value))}
                aria-label={t.taskForm.pointsAria}
              />
              <span>{t.taskForm.pointsUnit}</span>
            </div>
          </label>

          {taskType !== 'time_limited' && (
            <label className="field">
              <span>{t.taskForm.reminderTime}</span>
              <input
                type="time"
                value={`${String(reminderHour).padStart(2, '0')}:${String(reminderMinute).padStart(2, '0')}`}
                onChange={(event) => {
                  const [h, m] = event.target.value.split(':').map(Number)
                  if (Number.isFinite(h) && Number.isFinite(m)) {
                    setReminderHour(h)
                    setReminderMinute(m)
                  }
                }}
                aria-label={t.taskForm.reminderAria}
              />
            </label>
          )}
        </div>

        {taskType !== 'time_limited' && (
          <label className="field">
            <span>{taskType === 'recurring' ? t.taskForm.firstDueDate : t.taskForm.dueDate}</span>
            <input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value || today)}
            />
            <small>{formatDate(dueDate, language)}</small>
          </label>
        )}

        {members.length > 1 && (
          <label className="field">
            <span>{t.taskForm.assignedTo}</span>
            <select value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)}>
              <option value="">{t.common.everyone}</option>
              {members.map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {member.profile?.display_name || member.profile?.email || t.space.memberFallback}
                </option>
              ))}
            </select>
          </label>
        )}

        {error && <p className="error-text">{error}</p>}

        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            {t.common.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t.common.saving : existing ? t.common.save : t.taskForm.add}
          </button>
        </div>

        {onDelete && (
          <button
            type="button"
            className="btn btn-danger-text"
            onClick={async () => {
              if (!window.confirm(t.taskForm.confirmDelete(existing?.title ?? ''))) return
              setBusy(true)
              try {
                await onDelete()
              } catch (cause) {
                setError(errorMessage(cause))
                setBusy(false)
              }
            }}
          >
            {t.taskForm.delete}
          </button>
        )}
      </form>
    </div>
  )
}
