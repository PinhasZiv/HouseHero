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

/**
 * Opens when someone taps Done on a task: who actually did this? A household
 * chore is often done by whoever has a free hand, by everyone pitching in,
 * or by some specific subset of the house - so completing it needs to be
 * able to credit any of those, not just whoever tapped the button.
 */
export function CompletionSheet({ task, selfId, onChoose, onClose }: CompletionSheetProps) {
  const { t, language } = useI18n()
  const [members, setMembers] = useState<Member[] | null>(null)
  // Defaults to just the person opening this sheet - the common case is
  // "I did this, maybe with help", not starting from an empty list.
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

  async function choose(choice: CompletionChoice) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onChoose(choice)
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  function toggle(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  const roster = members ?? []
  const hasOthers = roster.some((member) => member.user_id !== selfId)

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <h2>{t.completion.title}</h2>
        <p className="screen-subtitle">{task.title}</p>

        <div className="completion-options">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void choose({ userIds: [selfId] })}
          >
            {t.completion.self}
          </button>

          {hasOthers && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void choose({ userIds: roster.map((member) => member.user_id) })}
            >
              {t.completion.together}
            </button>
          )}
        </div>

        {hasOthers && (
          <>
            <h3 className="group-title">{t.completion.multiSelectTitle}</h3>
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
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || selected.size === 0}
              onClick={() => void choose({ userIds: [...selected] })}
            >
              {t.completion.confirmSelection}
            </button>
          </>
        )}

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
