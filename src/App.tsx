import { useEffect, useState } from 'react'
import { isConfigured } from './lib/supabase'
import { registerServiceWorker } from './lib/push'
import { AppProvider, useApp } from './state/AppState'
import { ToastProvider } from './components/Toast'
import { SignIn } from './components/SignIn'
import { TodayScreen } from './components/TodayScreen'
import { TasksScreen } from './components/TasksScreen'
import { RewardsScreen } from './components/RewardsScreen'
import { StatsScreen } from './components/StatsScreen'
import { MoreScreen } from './components/MoreScreen'
import { SpaceSetup } from './components/SpaceScreen'
import { applyLanguageToDocument, useI18n } from './lib/i18n'
import { ChartIcon, DotsIcon, GiftIcon, HouseMark, ListIcon, TodayIcon } from './components/Icons'

type Tab = 'today' | 'tasks' | 'rewards' | 'stats' | 'more'

// The icons are fixed, the labels are not, so only the labels are looked up
// per render.
const TAB_ICONS: Record<Tab, (props: { size?: number }) => JSX.Element> = {
  today: TodayIcon,
  tasks: ListIcon,
  rewards: GiftIcon,
  stats: ChartIcon,
  more: DotsIcon,
}

const TAB_ORDER: Tab[] = ['today', 'tasks', 'rewards', 'stats', 'more']

export default function App() {
  useEffect(() => {
    void registerServiceWorker()
    // The <html> element carries the language chosen on this device, which the
    // inline script in index.html has already applied; this keeps it correct
    // after a hot reload or a language change made in another tab.
    applyLanguageToDocument()
  }, [])

  if (!isConfigured) return <SetupNeeded />

  return (
    <AppProvider>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </AppProvider>
  )
}

function Shell() {
  const { session, loading, error, spaces, currentSpace, setCurrentSpaceId } = useApp()
  const { t } = useI18n()
  const [tab, setTab] = useState<Tab>('today')

  if (loading) {
    return (
      <div className="centered-page">
        <HouseMark size={48} />
        <p className="muted">{t.common.loading}</p>
      </div>
    )
  }

  if (!session) return <SignIn />

  if (error) {
    return (
      <div className="centered-page">
        <h2>{t.common.somethingWrong}</h2>
        <p className="error-text">{error}</p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          {t.common.tryAgain}
        </button>
      </div>
    )
  }

  // Someone signed in with no space yet cannot do anything useful, so the
  // create/join sheet is the whole screen rather than a dismissible extra.
  if (spaces.length === 0) {
    return (
      <div className="centered-page">
        <HouseMark size={56} className="pop-in" />
        <h1>{t.onboarding.title}</h1>
        <p className="lede">{t.onboarding.lede}</p>
        <SpaceSetup onDone={() => setTab('tasks')} />
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-bar">
        <div className="app-title">
          <HouseMark size={26} />
          <span>{t.appName}</span>
        </div>
        {spaces.length > 1 && tab !== 'today' && (
          <select
            className="space-select"
            value={currentSpace?.id ?? ''}
            onChange={(event) => setCurrentSpaceId(event.target.value)}
            aria-label={t.space.switchAria}
          >
            {spaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
              </option>
            ))}
          </select>
        )}
      </header>

      <main className="app-body">
        {tab === 'today' && <TodayScreen onManageTasks={() => setTab('tasks')} />}
        {tab === 'tasks' && <TasksScreen />}
        {tab === 'rewards' && <RewardsScreen />}
        {tab === 'stats' && <StatsScreen />}
        {tab === 'more' && <MoreScreen />}
      </main>

      <nav className="tab-bar">
        {TAB_ORDER.map((id) => {
          const Icon = TAB_ICONS[id]
          return (
            <button
              key={id}
              type="button"
              className={tab === id ? 'tab tab-active' : 'tab'}
              onClick={() => setTab(id)}
              aria-current={tab === id ? 'page' : undefined}
            >
              <Icon size={22} />
              <span>{t.nav[id]}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}

/** Shown when the build has no Supabase details yet - a fresh deploy's state. */
function SetupNeeded() {
  const { t } = useI18n()
  return (
    <div className="centered-page">
      <HouseMark size={56} />
      <h1>{t.setup.title}</h1>
      <p className="lede">{t.setup.lede}</p>
      <p className="muted">{t.setup.body}</p>
    </div>
  )
}
