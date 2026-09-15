// The wording of task reminders, in both languages.
//
// This is the only part of the app someone sees without opening it, so it
// follows the language they picked in Settings rather than defaulting to one.
// The app records that choice on the profile precisely so this file can read
// it hours later, with no browser involved.

export type Language = 'he' | 'en'

export function isLanguage(value: unknown): value is Language {
  return value === 'he' || value === 'en'
}

/** "יום" / "יומיים" / "3 ימים", or "1 day" / "3 days". */
function days(count: number, language: Language): string {
  const n = Math.abs(count)
  if (language === 'en') return n === 1 ? '1 day' : `${n} days`
  if (n === 1) return 'יום'
  if (n === 2) return 'יומיים'
  return `${n} ימים`
}

function tasksWord(count: number, language: Language): string {
  if (language === 'en') return count === 1 ? '1 task' : `${count} tasks`
  return count === 1 ? 'משימה אחת' : `${count} משימות`
}

export interface DueEntry {
  name: string
  spaceName?: string
  daysLate: number
}

const MAX_NAMES_IN_BODY = 4

/** Turns a person's due/overdue list into the two lines of a notification. */
export function composeReminder(
  entries: DueEntry[],
  language: Language,
): { title: string; body: string } {
  const worstLate = Math.max(...entries.map((entry) => entry.daysLate))
  const count = entries.length

  const title =
    language === 'he'
      ? worstLate > 0
        ? `איחור של ${days(worstLate, 'he')} · ${tasksWord(count, 'he')}`
        : `הגיע הזמן למשימה · ${tasksWord(count, 'he')}`
      : worstLate > 0
        ? `${days(worstLate, 'en')} late · ${tasksWord(count, 'en')}`
        : `Time for a task · ${tasksWord(count, 'en')}`

  // The title already states the group's worst lateness ("2 days late · 3
  // tasks"). Repeating that same number on every line - or the only line,
  // for a single task - adds nothing; a per-task "(N days late)" only earns
  // its place in the body when the tasks are not all equally late, so each
  // line can be told apart from the others.
  const needsPerEntryLateness = count > 1 && entries.some((entry) => entry.daysLate !== worstLate)

  const described = entries.slice(0, MAX_NAMES_IN_BODY).map((entry) => {
    const where = entry.spaceName ? `${entry.spaceName}: ` : ''
    const lateness =
      needsPerEntryLateness && entry.daysLate > 0
        ? language === 'he'
          ? ` (${days(entry.daysLate, 'he')} איחור)`
          : ` (${days(entry.daysLate, 'en')} late)`
        : ''
    return `${where}${entry.name}${lateness}`
  })

  const remaining = count - described.length
  const more = language === 'he' ? `ועוד ${remaining}` : `+${remaining} more`
  const body = remaining > 0 ? `${described.join(', ')} ${more}` : described.join(', ')

  return { title, body }
}

export const TEST_NOTIFICATION: Record<Language, { title: string; body: string }> = {
  he: {
    title: 'HouseHero מוכן',
    body: 'ההתראות עובדות. בדיוק כזאת תגיע כשמשימה שלך תגיע לזמן שהוגדר לה.',
  },
  en: {
    title: 'HouseHero is set up',
    body: 'Notifications work. You will get one like this when a task of yours is due.',
  },
}

/**
 * The one-shot push sent the moment a task is assigned to someone specific -
 * separate from composeReminder, which only fires later, at the task's own
 * due time. `byName` is best-effort (the person who did the assigning may
 * have no display name or email on file) and simply drops from the sentence
 * when unknown, rather than falling back to a placeholder like "Someone".
 */
export function composeAssignment(
  taskName: string,
  byName: string | null,
  language: Language,
): { title: string; body: string } {
  if (language === 'en') {
    return {
      title: 'A task was assigned to you',
      body: byName ? `${byName} assigned you "${taskName}".` : `You were assigned "${taskName}".`,
    }
  }
  return {
    title: 'שויכה לך משימה',
    body: byName ? `${byName} שייך/ה לך את "${taskName}".` : `שויכה לך המשימה "${taskName}".`,
  }
}
