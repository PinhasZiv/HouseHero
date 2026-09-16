import { useEffect, useState } from 'react'
import * as api from '../lib/api'
import { errorMessage } from '../lib/errors'
import { initials } from '../lib/format'
import { useApp } from '../state/AppState'
import { useToast } from './Toast'
import { useI18n } from '../lib/i18n'
import type { Member } from '../lib/types'
import { ConfirmSheet } from './ConfirmSheet'

/** Who is in the space, how to invite someone else, and how to leave it. */
export function SpaceScreen() {
  const { currentSpace, spaces, session, reload, setCurrentSpaceId } = useApp()
  const { t } = useI18n()
  const toast = useToast()
  const [members, setMembers] = useState<Member[]>([])
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [showJoin, setShowJoin] = useState(false)
  const [confirming, setConfirming] = useState<'leave' | 'remove' | null>(null)

  useEffect(() => {
    if (!currentSpace) return
    let cancelled = false
    api
      .fetchMembers(currentSpace.id)
      .then((rows) => {
        if (!cancelled) setMembers(rows)
      })
      .catch((cause) => toast.showError(cause))
    return () => {
      cancelled = true
    }
  }, [currentSpace, toast])

  if (!currentSpace) return null

  const isOwner = members.some(
    (member) => member.user_id === session?.user.id && member.role === 'owner',
  )

  async function share() {
    const message = t.space.shareMessage(
      currentSpace!.name,
      `${window.location.origin}${import.meta.env.BASE_URL}`,
      currentSpace!.invite_code,
    )
    // The system share sheet is the natural path on a phone; the clipboard is
    // the fallback everywhere else.
    if (navigator.share) {
      try {
        await navigator.share({ title: t.space.shareTitle, text: message })
        return
      } catch {
        // Share sheet dismissed; fall through to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(message)
      toast.show(t.space.copied)
    } catch {
      toast.show(t.space.codeIs(currentSpace!.invite_code))
    }
  }

  async function rename() {
    try {
      await api.renameSpace(currentSpace!.id, draftName.trim())
      setRenaming(false)
      await reload()
    } catch (cause) {
      toast.showError(cause)
    }
  }

  async function leave() {
    await api.leaveSpace(currentSpace!.id)
    await reload()
    toast.show(t.space.left)
  }

  async function removeSpace() {
    await api.deleteSpace(currentSpace!.id)
    await reload()
    toast.show(t.space.removed)
  }

  return (
    <>
      <section className="card">
        {renaming ? (
          <div className="inline-form">
            <input
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              maxLength={60}
              aria-label={t.space.nameAria}
            />
            <button type="button" className="btn btn-primary btn-small" onClick={rename}>
              {t.common.save}
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setRenaming(false)}>
              {t.common.cancel}
            </button>
          </div>
        ) : (
          <div className="row-between">
            <h3>{currentSpace.name}</h3>
            {isOwner && (
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => {
                  setDraftName(currentSpace.name)
                  setRenaming(true)
                }}
              >
                {t.space.rename}
              </button>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h3>{t.space.inviteTitle}</h3>
        <p className="muted">{t.space.inviteBody}</p>
        <div className="invite-code" aria-label={t.space.inviteCodeAria}>
          {currentSpace.invite_code}
        </div>
        <button type="button" className="btn btn-primary" onClick={share}>
          {t.space.share}
        </button>
      </section>

      <section className="card">
        <h3>{t.space.members(members.length)}</h3>
        <ul className="member-list">
          {members.map((member) => (
            <li key={member.user_id}>
              {member.profile?.avatar_url ? (
                <img src={member.profile.avatar_url} alt="" className="avatar" referrerPolicy="no-referrer" />
              ) : (
                <span className="avatar avatar-initials">
                  {initials(member.profile?.display_name ?? null, member.profile?.email ?? null)}
                </span>
              )}
              <span className="member-name">
                {member.profile?.display_name || member.profile?.email || t.space.memberFallback}
                {member.user_id === session?.user.id && <span className="chip">{t.space.you}</span>}
              </span>
              {member.role === 'owner' && <span className="chip">{t.space.owner}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h3>{t.space.yourSpaces}</h3>
        <ul className="space-list">
          {spaces.map((space) => (
            <li key={space.id}>
              <button
                type="button"
                className={`space-row ${space.id === currentSpace.id ? 'space-row-active' : ''}`}
                onClick={() => setCurrentSpaceId(space.id)}
              >
                {space.name}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-ghost" onClick={() => setShowJoin(true)}>
          {t.space.createOrJoin}
        </button>
      </section>

      <section className="card card-quiet">
        <button type="button" className="btn btn-danger-text" onClick={() => setConfirming('leave')}>
          {t.space.leave}
        </button>
        {isOwner && (
          <button type="button" className="btn btn-danger" onClick={() => setConfirming('remove')}>
            {t.space.remove}
          </button>
        )}
      </section>

      {showJoin && <SpaceSetup onDone={() => setShowJoin(false)} allowCancel />}

      {confirming === 'leave' && (
        <ConfirmSheet
          title={t.space.leave}
          message={t.space.confirmLeave(currentSpace.name)}
          confirmLabel={t.space.leave}
          onConfirm={async () => {
            await leave()
            setConfirming(null)
          }}
          onCancel={() => setConfirming(null)}
        />
      )}

      {confirming === 'remove' && (
        <ConfirmSheet
          title={t.space.remove}
          message={t.space.confirmRemove(currentSpace.name)}
          confirmLabel={t.space.remove}
          onConfirm={async () => {
            await removeSpace()
            setConfirming(null)
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </>
  )
}

/**
 * Create or join. Used both for the very first space - where there is
 * nothing to cancel back to - and later from the Space screen.
 */
export function SpaceSetup({
  onDone,
  allowCancel = false,
}: {
  onDone: () => void
  allowCancel?: boolean
}) {
  const { reload, setCurrentSpaceId } = useApp()
  const { t } = useI18n()
  const toast = useToast()
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const space =
        mode === 'create'
          ? await api.createSpace(name.trim() || t.spaceSetup.defaultName)
          : await api.joinSpace(code)
      setCurrentSpaceId(space.id)
      await reload()
      toast.show(mode === 'create' ? t.spaceSetup.created(space.name) : t.spaceSetup.joined(space.name))
      onDone()
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={allowCancel ? onDone : undefined} role="presentation">
      <form className="sheet" onClick={(event) => event.stopPropagation()} onSubmit={submit}>
        <h2>{mode === 'create' ? t.spaceSetup.titleCreate : t.spaceSetup.titleJoin}</h2>

        <div className="segmented">
          <button
            type="button"
            className={mode === 'create' ? 'segment segment-active' : 'segment'}
            onClick={() => setMode('create')}
          >
            {t.spaceSetup.tabCreate}
          </button>
          <button
            type="button"
            className={mode === 'join' ? 'segment segment-active' : 'segment'}
            onClick={() => setMode('join')}
          >
            {t.spaceSetup.tabJoin}
          </button>
        </div>

        {mode === 'create' ? (
          <label className="field">
            <span>{t.spaceSetup.nameIt}</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t.spaceSetup.namePlaceholder}
              maxLength={60}
              autoComplete="off"
            />
            <small>{t.spaceSetup.nameHint}</small>
          </label>
        ) : (
          <label className="field">
            <span>{t.spaceSetup.codeLabel}</span>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder={t.spaceSetup.codePlaceholder}
              maxLength={6}
              autoCapitalize="characters"
              autoComplete="off"
              className="code-input"
            />
            <small>{t.spaceSetup.codeHint}</small>
          </label>
        )}

        {error && <p className="error-text">{error}</p>}

        <div className="sheet-actions">
          {allowCancel && (
            <button type="button" className="btn btn-ghost" onClick={onDone}>
              {t.common.cancel}
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t.common.working : mode === 'create' ? t.spaceSetup.create : t.spaceSetup.join}
          </button>
        </div>
      </form>
    </div>
  )
}
