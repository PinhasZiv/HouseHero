import { useEffect, useState } from 'react'
import * as api from '../lib/api'
import {
  currentPushState,
  disablePush,
  enablePush,
  isInstalled,
  sendTestNotification,
  type PushState,
} from '../lib/push'
import { LANGUAGE_NAMES, LANGUAGES, useI18n, type Language } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import { useApp } from '../state/AppState'
import { useToast } from './Toast'

export function SettingsScreen() {
  const { profile, session, setProfile } = useApp()
  const { t, language, setLanguage } = useI18n()
  const toast = useToast()
  const [pushState, setPushState] = useState<PushState>('prompt')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void currentPushState().then(setPushState)
  }, [])

  // Keeps the stored timezone in step with the device, silently - a task's
  // reminder is computed against this value, so someone who moved should get
  // reminded at the right local time without opening a settings toggle for it.
  useEffect(() => {
    if (!profile || !session) return
    const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (profile.timezone === deviceTimezone) return
    void api
      .updateProfile(session.user.id, { timezone: deviceTimezone })
      .then(setProfile)
      .catch(() => {})
  }, [profile, session, setProfile])

  if (!profile || !session) return null

  async function toggleReminders(enabled: boolean) {
    setBusy(true)
    try {
      if (enabled) {
        const next = await enablePush(session!.user.id)
        setPushState(next)
        if (next === 'subscribed') toast.show(t.settings.enabled)
        if (next === 'denied') toast.show(t.settings.blockedToast, { tone: 'error' })
      } else {
        await disablePush()
        setPushState('prompt')
        toast.show(t.settings.disabled)
      }
    } catch (cause) {
      toast.showError(cause)
    } finally {
      setBusy(false)
    }
  }

  /**
   * The choice is stored on the profile as well as on the device, for two
   * reasons: it follows you to a new phone, and the reminder job needs it -
   * that notification is composed on the server, potentially hours after you
   * last had the app open.
   */
  async function chooseLanguage(next: Language) {
    setLanguage(next)
    try {
      const updated = await api.updateProfile(session!.user.id, { language: next })
      setProfile(updated)
    } catch (cause) {
      // The screen has already switched; only the sync failed.
      toast.showError(cause)
    }
  }

  return (
    <>
      <section className="card">
        <h3>{t.settings.language}</h3>
        <p className="muted">{t.settings.languageBody}</p>
        <div className="segmented" role="group" aria-label={t.settings.language}>
          {LANGUAGES.map((option) => (
            <button
              key={option}
              type="button"
              lang={option}
              className={option === language ? 'segment segment-active' : 'segment'}
              aria-pressed={option === language}
              onClick={() => chooseLanguage(option)}
            >
              {LANGUAGE_NAMES[option]}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>{t.settings.notifications}</h3>
        <PushStatus state={pushState} />

        {pushState === 'subscribed' ? (
          <>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={async () => {
                const result = await sendTestNotification()
                toast.show(result.message, { tone: result.ok ? 'info' : 'error' })
              }}
            >
              {t.settings.sendTest}
            </button>
            <button
              type="button"
              className="btn btn-danger-text"
              disabled={busy}
              onClick={() => toggleReminders(false)}
            >
              {t.settings.turnOff}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || pushState === 'unsupported' || pushState === 'unconfigured'}
            onClick={() => toggleReminders(true)}
          >
            {busy ? t.common.working : t.settings.turnOn}
          </button>
        )}

        {!isInstalled() && <p className="muted small">{t.settings.installHint}</p>}
        <p className="muted small">{t.settings.timezone(profile.timezone)}</p>
      </section>

      <section className="card">
        <h3>{t.settings.account}</h3>
        <p className="muted">{profile.email}</p>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={async () => {
            await supabase.auth.signOut()
          }}
        >
          {t.settings.signOut}
        </button>
      </section>
    </>
  )
}

/** Says which of the several ways notifications can be off is the one here. */
function PushStatus({ state }: { state: PushState }) {
  const { t } = useI18n()
  const tone = state === 'subscribed' ? 'ok' : state === 'prompt' ? 'neutral' : 'warn'
  return <p className={`status status-${tone}`}>{t.settings.pushState[state]}</p>
}
