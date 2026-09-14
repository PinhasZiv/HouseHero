import { useEffect, useState } from 'react'
import * as api from '../lib/api'
import type { CompletionChoice } from '../lib/api'
import { errorMessage } from '../lib/errors'
import { firstName } from '../lib/format'
import { useI18n } from '../lib/i18n'
import type { Member, Task } from '../lib/types'

interface CompletionSheetProps {
  task: Task
  selfId: string
  onChoose: (choice: CompletionChoice) => Promise<void>
  onClose: () => void
}

type Mode = 'self' | 'everyone' | 'custom'

/**
 * Opens when someone taps Done on a task: who actually did this? A household
 * chore is often done by whoever has a free hand, by everyone pitching in,
 * or by some specific subset of the house - so completing it needs to be
 * able to credit any of those, not just whoever tapped the button.
 *
 * The three options are one segmented control, same as the owner-filter tabs
 * on the Tasks screen and the pickers in TaskForm - the active choice stays
 * visibly highlighted rather than looking like three equally "pressed"
 * buttons, and only tapping Confirm submits anything. The full member list
 * is not shown until "custom" is chosen - full disclosure only when asked
 * for, not by default.
 */
export function CompletionSheet({ task, selfId, onChoose, onClose }: CompletionSheetProps) {
  const { t, language } = useI18n()
  const [members, setMembers] = useState<Member[] | null>(null)
  const [mode, setMode] = useState<Mode>('self')
  // Defaults to just the person opening this sheet - the common case for a
  // custom pick is "I did this, plus someone else", not starting empty.
  const [selected, setSelected] = useState<Set<string>>(() => new Set([selfId]))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .fetchMembers(task.space_id)
      .then((rows) => {
        if (!cancelled) setMembers(rows)
      })
      .catch(() => {
        // Non-fatal: "I did it" still works without the member list, only
        // the other two options depend on it.
        if (!cancelled) setMembers([])
      })
    return () => {
      cancelled = true
    }
  }, [task.space_id])

  function toggle(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  async function confirm() {
    if (busy) return
    const userIds =
      mode === 'everyone' ? roster.map((member) => member.user_id) : mode === 'custom' ? [...selected] : [selfId]
    setBusy(true)
    setError(null)
    try {
      await onChoose({ userIds })
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  const roster = members ?? []
  const hasOthers = roster.some((member) => member.user_id !== selfId)
  const confirmDisabled = busy || (mode === 'custom' && selected.size === 0)

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <h2>{t.completion.title}</h2>
        <p className="screen-subtitle">{task.title}</p>

        {hasOthers ? (
          <div className="segmented" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'self'}
              className={mode === 'self' ? 'segment segment-active' : 'segment'}
              onClick={() => setMode('self')}
            >
              {t.completion.self}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'everyone'}
              className={mode === 'everyone' ? 'segment segment-active' : 'segment'}
              onClick={() => setMode('everyone')}
            >
              {t.completion.together}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'custom'}
              className={mode === 'custom' ? 'segment segment-active' : 'segment'}
              onClick={() => setMode('custom')}
            >
              {t.completion.multiSelectTitle}
            </button>
          </div>
        ) : (
          <p className="muted">{t.completion.self}</p>
        )}

        {mode === 'custom' && hasOthers && (
          <div className="completion-checklist">
            {roster.map((member) => {
              const isSelf = member.user_id === selfId
              const name = firstName(member.profile?.display_name ?? null, member.profile?.email ?? null, language)
              return (
                <label key={member.user_id} className="completion-check-row">
                  <input
                    type="checkbox"
                    checked={selected.has(member.user_id)}
                    disabled={busy}
                    onChange={() => toggle(member.user_id)}
                  />
                  <span>{isSelf ? `${name} (${t.completion.you})` : name}</span>
                </label>
              )
            })}
          </div>
        )}

        <button type="button" className="btn btn-primary" disabled={confirmDisabled} onClick={() => void confirm()}>
          {t.completion.confirmSelection}
        </button>

        {error && <p className="error-text">{error}</p>}

        <div className="sheet-actions sheet-actions-sticky">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {t.common.cancel}
          </button>
        </div>
      </div>
    </div>
  )
}
