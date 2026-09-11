import { daysBetween, todayIn } from './taskDue'
import type { Language } from './i18n/types'

// Numbers, dates and names, in whichever language is showing.
//
// Hebrew has a dual form - "יומיים", not "2 ימים" - and inflects nouns by
// number. English does neither. The difference is small but it is what
// separates an interface that reads like Hebrew from one that reads like a
// machine translation, so it lives here rather than in each dictionary.

const LOCALES: Record<Language, string> = { he: 'he-IL', en: 'en-GB' }

/** "יום" / "יומיים" / "3 ימים", or "1 day" / "3 days". */
export function days(count: number, language: Language): string {
  const n = Math.abs(count)
  if (language === 'en') return n === 1 ? '1 day' : `${n} days`
  if (n === 1) return 'יום'
  if (n === 2) return 'יומיים'
  return `${n} ימים`
}

/** "משימה אחת" / "2 משימות", or "1 task" / "2 tasks". */
export function tasksWord(count: number, language: Language): string {
  if (language === 'en') return count === 1 ? '1 task' : `${count} tasks`
  return count === 1 ? 'משימה אחת' : `${count} משימות`
}

/** "נקודה אחת" / "5 נקודות", or "1 point" / "5 points". */
export function pointsWord(count: number, language: Language): string {
  if (language === 'en') return count === 1 ? '1 point' : `${count} points`
  return count === 1 ? 'נקודה אחת' : `${count} נקודות`
}

export function initials(name: string | null, email: string | null): string {
  const source = (name || email || '?').trim()
  const parts = source.split(/[\s@._-]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export function firstName(
  name: string | null,
  email: string | null,
  language: Language,
): string {
  const fallback = language === 'he' ? 'מישהו' : 'someone'
  const source = (name || email || fallback).trim()
  return source.split(/[\s@]/)[0]
}

/** Who did something: you, someone else by name (if known), or nobody. */
export type PersonLabel = { kind: 'you' } | { kind: 'other'; name: string | null } | null

/**
 * Resolves a user id to "you" / a first name / "someone" - shared by every
 * place that says who completed a task, whether that is the task's current
 * state or one row of its permanent history.
 */
export function personLabel(
  userId: string | null,
  people: Map<string, { display_name: string | null; email: string | null }>,
  selfId: string | null,
  language: Language,
): PersonLabel {
  if (!userId) return null
  if (userId === selfId) return { kind: 'you' }
  const person = people.get(userId)
  // A null name means "we do not know who", which each language words itself.
  return { kind: 'other', name: person ? firstName(person.display_name, person.email, language) : null }
}

/** "היום" / "בעוד יומיים", or "today" / "in 2 days". */
export function relativeDay(isoDate: string, today: string, language: Language): string {
  const delta = daysBetween(today, isoDate)

  if (language === 'en') {
    if (delta === 0) return 'today'
    if (delta === 1) return 'tomorrow'
    if (delta === -1) return 'yesterday'
    return delta > 0 ? `in ${days(delta, 'en')}` : `${days(delta, 'en')} ago`
  }

  if (delta === 0) return 'היום'
  if (delta === 1) return 'מחר'
  if (delta === 2) return 'מחרתיים'
  if (delta === -1) return 'אתמול'
  return delta > 0 ? `בעוד ${days(delta, 'he')}` : `לפני ${days(delta, 'he')}`
}

/** "יום ה׳, 3 בספט׳" / "Thu, 3 Sep" */
export function formatDate(isoDate: string, language: Language): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(LOCALES[language], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

export function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/**
 * "20:30" if the snooze ends later today, else "מחר 08:00" / "tomorrow
 * 08:00" - whichever tells you fastest whether to expect it again today.
 *
 * The snooze instant was chosen against this device's own clock, so the
 * calendar-day comparison uses this device's own timezone too, rather than
 * `today` (the signed-in person's timezone) - the two agree except for
 * someone actively traveling, which is not worth the extra plumbing to fix.
 */
export function formatSnoozeUntil(iso: string, today: string, language: Language): string {
  const target = new Date(iso)
  const time = target.toLocaleTimeString(LOCALES[language], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const targetDay = todayIn(deviceTimezone, target)
  if (targetDay === today) return time
  return `${relativeDay(targetDay, today, language)} ${time}`
}

/** "כל יום" / "פעם בשבוע" / "every day" / "weekly" */
export function describeInterval(intervalDays: number, language: Language): string {
  if (language === 'en') {
    if (intervalDays === 1) return 'every day'
    if (intervalDays === 7) return 'weekly'
    if (intervalDays === 14) return 'every 2 weeks'
    if (intervalDays === 21) return 'every 3 weeks'
    if (intervalDays === 30) return 'monthly'
    return `every ${intervalDays} days`
  }

  if (intervalDays === 1) return 'כל יום'
  if (intervalDays === 2) return 'כל יומיים'
  if (intervalDays === 7) return 'פעם בשבוע'
  if (intervalDays === 14) return 'פעם בשבועיים'
  if (intervalDays === 21) return 'פעם בשלושה שבועות'
  if (intervalDays === 30) return 'פעם בחודש'
  return `כל ${intervalDays} ימים`
}

/** Short weekday label for day-of-week pickers. index: 0=Sunday..6=Saturday. */
export function weekdayShort(index: number, language: Language): string {
  const he = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']
  const en = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return language === 'en' ? en[index] : he[index]
}

/** "שני, רביעי" / "Mon, Wed" - the chosen weekdays, in week order. */
export function describeWeeklyDays(weeklyDays: number[], language: Language): string {
  const he = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
  const en = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const names = language === 'en' ? en : he
  return [...weeklyDays]
    .sort((a, b) => a - b)
    .map((d) => names[d])
    .join(language === 'en' ? ', ' : ', ')
}
