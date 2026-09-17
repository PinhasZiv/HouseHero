import { useEffect, useState } from 'react'
import * as api from '../lib/api'
import { burstConfetti, failAt } from '../lib/celebrate'
import { errorMessage } from '../lib/errors'
import { useI18n } from '../lib/i18n'
import { useApp } from '../state/AppState'
import { useToast } from './Toast'
import { PointsBar } from './PointsBar'
import { ConfirmSheet } from './ConfirmSheet'
import { GiftIcon, PencilIcon, PlusIcon } from './Icons'
import type { Reward, RewardRedemption } from '../lib/types'

interface RewardDraft {
  title: string
  description: string
  cost: number
}

function RewardForm({
  existing,
  onCancel,
  onSave,
  onDelete,
}: {
  existing?: Reward
  onCancel: () => void
  onSave: (draft: RewardDraft) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const { t } = useI18n()
  const [title, setTitle] = useState(existing?.title ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [cost, setCost] = useState(existing?.cost ?? 50)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim()) return setError(t.rewards.errorNoName)
    if (!Number.isInteger(cost) || cost < 1) return setError(t.rewards.errorCost)
    setBusy(true)
    setError(null)
    try {
      await onSave({ title, description, cost })
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  return (
    <>
      <div className="sheet-backdrop" onClick={onCancel} role="presentation">
        <form className="sheet" onClick={(event) => event.stopPropagation()} onSubmit={save}>
          <h2>{existing ? t.rewards.titleEdit : t.rewards.titleNew}</h2>

          <label className="field">
            <span>{t.rewards.name}</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t.rewards.namePlaceholder}
              maxLength={80}
              autoFocus
            />
          </label>

          <label className="field">
            <span>{t.taskForm.description}</span>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={200}
            />
          </label>

          <label className="field">
            <span>{t.rewards.costLabel}</span>
            <input
              type="number"
              min={1}
              max={100000}
              value={cost}
              onChange={(event) => setCost(Number(event.target.value))}
            />
          </label>

          {error && <p className="error-text">{error}</p>}

          <div className="sheet-actions">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              {t.common.cancel}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? t.common.saving : existing ? t.common.save : t.rewards.add}
            </button>
          </div>

          {onDelete && (
            <button type="button" className="btn btn-danger-text" onClick={() => setConfirmingDelete(true)}>
              {t.rewards.delete}
            </button>
          )}
        </form>
      </div>

      {onDelete && confirmingDelete && (
        <ConfirmSheet
          title={t.rewards.delete}
          message={t.rewards.confirmDelete(existing?.title ?? '')}
          confirmLabel={t.rewards.delete}
          onConfirm={onDelete}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </>
  )
}

export function RewardsScreen() {
  const { currentSpace, session, profile, people } = useApp()
  const { t } = useI18n()
  const toast = useToast()
  const selfId = session?.user.id ?? null

  const [rewards, setRewards] = useState<Reward[]>([])
  const [redemptions, setRedemptions] = useState<RewardRedemption[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Reward | null>(null)
  const [celebrate, setCelebrate] = useState(false)

  async function load() {
    if (!currentSpace) return
    const [nextRewards, nextRedemptions] = await Promise.all([
      api.fetchRewards(currentSpace.id),
      api.fetchRedemptions(currentSpace.id),
    ])
    setRewards(nextRewards)
    setRedemptions(nextRedemptions)
    setLoading(false)
  }

  useEffect(() => {
    setLoading(true)
    void load().catch((cause) => {
      toast.showError(cause)
      setLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSpace?.id])

  if (!currentSpace || !profile) return null

  const pending = redemptions.filter((r) => r.status === 'pending')

  async function redeem(reward: Reward, event: React.MouseEvent<HTMLButtonElement>) {
    const { clientX: x, clientY: y } = event
    try {
      await api.requestRedemption(reward.id)
      burstConfetti(x, y)
      toast.show(t.rewards.requested(reward.title))
      await load()
    } catch (cause) {
      failAt(x, y)
      toast.showError(cause)
    }
  }

  async function approve(redemption: RewardRedemption, event: React.MouseEvent<HTMLButtonElement>) {
    const { clientX: x, clientY: y } = event
    try {
      await api.approveRedemption(redemption.id)
      burstConfetti(x, y)
      toast.show(t.rewards.approved(redemption.reward_title))
      setCelebrate(true)
      window.setTimeout(() => setCelebrate(false), 900)
      await load()
    } catch (cause) {
      failAt(x, y)
      toast.showError(cause)
    }
  }

  // Rejecting is itself a "no" - even when the action succeeds, this shows
  // the same failure-style mark as an error, never a celebration.
  async function reject(redemption: RewardRedemption, event: React.MouseEvent<HTMLButtonElement>) {
    const { clientX: x, clientY: y } = event
    try {
      await api.rejectRedemption(redemption.id)
      toast.show(t.rewards.rejected(redemption.reward_title))
      await load()
    } catch (cause) {
      toast.showError(cause)
    } finally {
      failAt(x, y)
    }
  }

  async function cancel(redemption: RewardRedemption, event: React.MouseEvent<HTMLButtonElement>) {
    const { clientX: x, clientY: y } = event
    try {
      await api.cancelRedemption(redemption.id)
      toast.show(t.rewards.cancelled(redemption.reward_title))
      await load()
    } catch (cause) {
      failAt(x, y)
      toast.showError(cause)
    }
  }

  async function addReward(draft: RewardDraft) {
    if (!session || !currentSpace) return
    await api.createReward({ spaceId: currentSpace.id, ...draft }, session.user.id)
    setAdding(false)
    await load()
    toast.show(t.rewards.added(draft.title.trim()))
  }

  async function saveReward(draft: RewardDraft) {
    if (!editing) return
    await api.updateReward(editing.id, {
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      cost: draft.cost,
    })
    setEditing(null)
    await load()
  }

  async function removeReward() {
    if (!editing) return
    await api.deleteReward(editing.id)
    setEditing(null)
    await load()
    toast.show(t.rewards.deleted)
  }

  return (
    <div className="screen fade-in">
      <header className="screen-header">
        <h2>{t.rewards.title}</h2>
      </header>

      <PointsBar lifetime={profile.lifetime_points} spendable={profile.spendable_points} celebrate={celebrate} />

      {pending.length > 0 && (
        <section className="task-group">
          <h3 className="group-title">{t.rewards.pendingTitle}</h3>
          {pending.map((redemption) => {
            const mine = redemption.requested_by === selfId
            const requester = people.get(redemption.requested_by)
            return (
              <article key={redemption.id} className="task-card">
                <div className="task-main">
                  <div className="task-headline">
                    <h3 className="task-name">{redemption.reward_title}</h3>
                    <span className="badge badge-points">{t.rewards.cost(redemption.cost)}</span>
                  </div>
                  <p className="task-meta">
                    <span>
                      {mine
                        ? t.rewards.pendingMine(redemption.reward_title)
                        : t.rewards.pendingTheirs(
                            requester?.display_name || requester?.email || t.task.someoneElse,
                            redemption.reward_title,
                          )}
                    </span>
                  </p>
                </div>
                <div className="row-actions">
                  {mine ? (
                    <button
                      type="button"
                      className="complete-button complete-button-muted"
                      onClick={(event) => cancel(redemption, event)}
                      aria-label={t.rewards.cancelAria(redemption.reward_title)}
                    >
                      {t.rewards.cancel}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="complete-button"
                        onClick={(event) => approve(redemption, event)}
                        aria-label={t.rewards.approveAria(redemption.reward_title)}
                      >
                        {t.rewards.approve}
                      </button>
                      <button
                        type="button"
                        className="complete-button complete-button-muted"
                        onClick={(event) => reject(redemption, event)}
                        aria-label={t.rewards.rejectAria(redemption.reward_title)}
                      >
                        {t.rewards.reject}
                      </button>
                    </>
                  )}
                </div>
              </article>
            )
          })}
        </section>
      )}

      {loading ? (
        <p className="muted">{t.common.loading}</p>
      ) : rewards.length === 0 ? (
        <div className="empty-state">
          <GiftIcon size={40} />
          <p>{t.rewards.emptyBody}</p>
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            {t.rewards.addFirst}
          </button>
        </div>
      ) : (
        <section className="task-group">
          {rewards.map((reward) => (
            <article key={reward.id} className="task-card">
              <div className="task-main">
                <div className="task-headline">
                  <h3 className="task-name">{reward.title}</h3>
                  <span
                    className={`badge badge-points ${profile.spendable_points < reward.cost ? 'badge-muted' : ''}`}
                  >
                    {t.rewards.cost(reward.cost)}
                  </span>
                </div>
                {reward.description && <p className="task-meta">{reward.description}</p>}
              </div>
              <button
                type="button"
                className="complete-button"
                onClick={(event) => redeem(reward, event)}
                aria-label={t.rewards.redeemAria(reward.title)}
              >
                {t.rewards.redeem}
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => setEditing(reward)}
                aria-label={t.task.editAria(reward.title)}
              >
                <PencilIcon size={17} />
              </button>
            </article>
          ))}
        </section>
      )}

      <button type="button" className="fab" onClick={() => setAdding(true)} aria-label={t.rewards.addAria}>
        <PlusIcon size={24} />
      </button>

      {adding && <RewardForm onCancel={() => setAdding(false)} onSave={addReward} />}
      {editing && (
        <RewardForm
          existing={editing}
          onCancel={() => setEditing(null)}
          onSave={saveReward}
          onDelete={removeReward}
        />
      )}
    </div>
  )
}
