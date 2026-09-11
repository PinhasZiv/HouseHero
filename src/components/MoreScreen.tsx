import { useI18n } from '../lib/i18n'
import { SettingsScreen } from './SettingsScreen'
import { SpaceScreen } from './SpaceScreen'

/**
 * Household space management and personal settings, sharing one tab. Neither
 * is something people reach for often enough to earn its own place in a
 * five-item bottom bar, but both need to live somewhere reachable.
 */
export function MoreScreen() {
  const { t } = useI18n()
  return (
    <div className="screen fade-in">
      <header className="screen-header">
        <h2>{t.space.title}</h2>
        <p className="screen-subtitle">{t.space.subtitle}</p>
      </header>
      <SpaceScreen />

      <header className="screen-header screen-header-secondary">
        <h2>{t.settings.title}</h2>
      </header>
      <SettingsScreen />
    </div>
  )
}
