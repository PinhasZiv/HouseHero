import { useState } from 'react'
import { LANGUAGE_NAMES, useI18n } from '../lib/i18n'
import { personalPause, spacePause } from '../lib/pauses'
import { useBackClose } from '../lib/useDialog'
import { useApp } from '../state/AppState'
import { SettingsScreen, type SettingsPart } from './SettingsScreen'
import { SpaceScreen, type SpacePart } from './SpaceScreen'

type Section = SpacePart | SettingsPart

const SPACE_PARTS: SpacePart[] = ['space', 'vacation', 'invite']
const SETTINGS_PARTS: SettingsPart[] = ['notifications', 'language', 'account']

/**
 * The space's management and the app's settings: a short list, each row
 * opening its own screen - all of it on one page ran five phone screens
 * long. Back (the button, or the phone's own) returns to the list.
 */
export function MoreScreen() {
  const { t, language } = useI18n()
  const { currentSpace, pauses, session, profile } = useApp()
  const [section, setSection] = useState<Section | null>(null)
  useBackClose(() => setSection(null), section !== null)

  const selfId = session?.user.id ?? null
  const onVacation =
    currentSpace !== null &&
    (spacePause(pauses, currentSpace.id) !== null || (selfId !== null && personalPause(pauses, currentSpace.id, selfId) !== null))

  const titles: Record<Section, string> = {
    space: t.more.spaceRow,
    vacation: t.vacation.title,
    invite: t.space.inviteTitle,
    notifications: t.settings.notifications,
    language: t.settings.language,
    account: t.settings.account,
  }
  const details: Partial<Record<Section, string>> = {
    space: currentSpace?.name,
    vacation: onVacation ? t.more.vacationOn : t.more.vacationOff,
    invite: currentSpace?.invite_code,
    language: LANGUAGE_NAMES[language],
    account: profile?.email ?? undefined,
  }

  if (section) {
    const isSpacePart = (SPACE_PARTS as Section[]).includes(section)
    return (
      <div className={`screen fade-in ${section === 'space' ? '' : 'subpage-single'}`}>
        <header className="screen-header subpage-header">
          <button type="button" className="back-button" onClick={() => setSection(null)}>
            {t.more.back}
          </button>
          <h1>{titles[section]}</h1>
        </header>
        {isSpacePart ? <SpaceScreen part={section as SpacePart} /> : <SettingsScreen part={section as SettingsPart} />}
      </div>
    )
  }

  const row = (id: Section) => (
    <li key={id}>
      <button type="button" className="menu-row" onClick={() => setSection(id)}>
        <span className="menu-row-title">{titles[id]}</span>
        {details[id] && <span className="menu-row-detail">{details[id]}</span>}
      </button>
    </li>
  )

  return (
    <div className="screen fade-in">
      <header className="screen-header">
        <h1>{t.more.title}</h1>
      </header>

      <h2 className="menu-group-title">{t.space.title}</h2>
      <ul className="menu-list">{SPACE_PARTS.map(row)}</ul>

      <h2 className="menu-group-title">{t.settings.title}</h2>
      <ul className="menu-list">{SETTINGS_PARTS.map(row)}</ul>
    </div>
  )
}
