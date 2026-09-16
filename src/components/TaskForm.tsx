import { useEffect, useState } from 'react'
import { addDays } from '../lib/taskDue'
import { errorMessage } from '../lib/errors'
import { formatDate, weekdayShort } from '../lib/format'
import { useI18n } from '../lib/i18n'
import type { EndCondition, RecurrenceMode, TaskType } from '../lib/taskDue'
import type { Member, Task } from '../lib/types'

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
}

interface TaskFormProps {
  today: string
  existing?: Task
  members: Member[]
  onCancel: () => void
  onSave: (draft: TaskDraft) => Promise<void>
  onDelete?: () => Promise<void>
}

const INTERVAL_PRESETS = [1, 7, 14, 30]

export function TaskForm({ today, existing, members, onCancel, onSave, onDelete }: TaskFormProps) {
  const { t, language } = useI18n()

  const [title, setTitle] = useState(existing?.title ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [taskType, setTaskType] = useState<TaskType>(existing?.task_type ?? 'recurring')
  const [recurrenceMode, setRecurrenceMode] = useState<RecurrenceMode>(
    existing?.recurrence_mode ?? 'interval',
  )
  const [intervalDays, setIntervalDays] = useState(existing?.interval_days ?? 7)
  const [weeklyDays, setWeeklyDays] = useState<number[]>(existing?.weekly_days ?? [])
  const [endCondition, setEndCondition] = useState<EndCondition>(existing?.end_condition ?? 'never')
  const [endAfterCount, setEndAfterCount] = useState(existing?.end_after_count ?? 10)
  const [endDate, setEndDate] = useState(existing?.end_date ?? addDays(today, 30))
  const [points, setPoints] = useState(existing?.points ?? 10)
  const [reminderHour, setReminderHour] = useState(existing?.reminder_hour ?? 9)
  const [reminderMinute, setReminderMinute] = useState(existing?.reminder_minute ?? 0)
  // New task defaults to "due today", which is almost always what is meant
  // when adding one in the moment.
  const [dueDate, setDueDate] = useState(existing?.due_date ?? today)
  const [assignedTo, setAssignedTo] = useState(existing?.assigned_to ?? '')
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
          </div>
        </fieldset>

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
              <div className="segmented segmented-wrap">
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
        </div>

        <label className="field">
          <span>{taskType === 'recurring' ? t.taskForm.firstDueDate : t.taskForm.dueDate}</span>
          <input
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value || today)}
          />
          <small>{formatDate(dueDate, language)}</small>
        </label>

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
