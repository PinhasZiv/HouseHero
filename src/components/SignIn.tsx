import { useState } from 'react'
import { appUrl, supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { HouseMark } from './Icons'

export function SignIn() {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signIn() {
    setBusy(true)
    setError(null)
    const { error: cause } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: appUrl(),
        queryParams: { prompt: 'select_account' },
      },
    })
    if (cause) {
      setError(cause.message)
      setBusy(false)
    }
  }

  return (
    <div className="centered-page">
      <div className="hero">
        <HouseMark size={72} className="pop-in" />
        <h1>{t.appName}</h1>
        <p className="lede">{t.signIn.tagline}</p>
      </div>

      <button type="button" className="btn btn-google" onClick={signIn} disabled={busy}>
        <GoogleMark />
        {busy ? t.signIn.opening : t.signIn.button}
      </button>

      {error && <p className="error-text">{error}</p>}

      <p className="fine-print">{t.signIn.privacy}</p>
    </div>
  )
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.7 30.2.5 24 .5 14.6.5 6.5 5.9 2.6 13.7l7.8 6.1C12.3 13.9 17.6 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.6 24.6c0-1.6-.1-3.1-.4-4.6H24v9.1h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 6.9-10 6.9-17.5z" />
      <path fill="#FBBC05" d="M10.4 28.2c-.5-1.4-.8-2.9-.8-4.2s.3-2.9.8-4.2l-7.8-6.1C.9 16.7 0 20.2 0 24s.9 7.3 2.6 10.3l7.8-6.1z" />
      <path fill="#34A853" d="M24 47.5c6.2 0 11.4-2 15.2-5.5l-7.5-5.8c-2 1.4-4.7 2.3-7.7 2.3-6.4 0-11.7-4.4-13.6-10.3l-7.8 6.1C6.5 42.1 14.6 47.5 24 47.5z" />
    </svg>
  )
}
