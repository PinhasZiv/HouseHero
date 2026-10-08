import { useState } from 'react'
import { formatDate } from '../lib/format'
import { useI18n } from '../lib/i18n'
import { personalPause, spacePause } from '../lib/pauses'
import type { Member } from '../lib/types'
import { useApp } from '../state/AppState'
import { usePause } from '../state/usePause'
import { ConfirmSheet } from './ConfirmSheet'

/**
 * Vacation mode for one space: anyone can go away themselves, and the owner
 * can send the whole space away. Switched on and off by hand - there is no
 * date range to get wrong when a flight is delayed.
 */
export function VacationCard({ spaceId, isOwner, members }: { spaceId: string; isOwner: boolean; members: Member[] }) {
  const { pauses, session } = useApp()
  const { start, end } = usePause()
  const { t, language } = useI18n()
  const [busy, setBusy] = useState(false)
  const [confirmingSpace, setConfirmingSpace] = useState(false)
  const selfId = session?.user.id ?? null

  const whole = spacePause(pauses, spaceId)
  const mine = selfId ? personalPause(pauses, spaceId, selfId) : null
  const awayNames = members
    .filter((member) => member.user_id !== selfId && personalPause(pauses, spaceId, member.user_id))
    .map((member) => member.profile?.display_name || member.profile?.email || t.space.memberFallback)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card vacation-card">
      <h3>{t.vacation.title}</h3>

      {whole ? (
        <>
          <p className="vacation-state">{t.vacation.spaceOn(formatDate(whole.started_on, language))}</p>
          {isOwner ? (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(() => end(whole))}>
              {t.vacation.backSpace}
            </button>
          ) : (
            <p className="muted small">{t.vacation.ownerEnds}</p>
          )}
        </>
      ) : (
        <p className="muted">{t.vacation.body}</p>
      )}

      {mine ? (
        <>
          <p className="vacation-state">{t.vacation.selfOn(formatDate(mine.started_on, language))}</p>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(() => end(mine))}>
            {t.vacation.back}
          </button>
        </>
      ) : (
        !whole && (
          <>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => run(() => start(spaceId, false))}>
              {t.vacation.start}
            </button>
            <p className="muted small">{t.vacation.startHint}</p>
          </>
        )
      )}

      {!whole && isOwner && (
        <>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setConfirmingSpace(true)}>
            {t.vacation.startSpace}
          </button>
          <p className="muted small">{t.vacation.startSpaceHint}</p>
        </>
      )}

      {awayNames.length > 0 && <p className="muted small">{t.vacation.awayNow(awayNames.join(', '))}</p>}

      {confirmingSpace && (
        <ConfirmSheet
          title={t.vacation.startSpace}
          message={t.vacation.startSpaceHint}
          confirmLabel={t.vacation.startSpace}
          onConfirm={async () => {
            await start(spaceId, true)
            setConfirmingSpace(false)
          }}
          onCancel={() => setConfirmingSpace(false)}
        />
      )}
    </section>
  )
}
