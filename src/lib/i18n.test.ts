import { describe, expect, it } from 'vitest'
import { en } from './i18n/en'
import { he } from './i18n/he'
import { directionOf, isLanguage, LANGUAGES } from './i18n/types'
import { days, pointsWord, tasksWord } from './format'
import { composeReminder, composeTimeLimitedReminder } from '../../supabase/functions/_shared/messages.ts'

// The type system already forces the two dictionaries to have the same shape.
// These tests cover what it cannot: that no entry was left in the wrong
// language, and that the number and date wording is right in both.

describe('the dictionaries', () => {
  const entries = (value: unknown, path = ''): [string, string][] => {
    if (typeof value === 'string') return [[path, value]]
    if (typeof value === 'function') return []
    if (value && typeof value === 'object') {
      return Object.entries(value).flatMap(([key, child]) => entries(child, path ? `${path}.${key}` : key))
    }
    return []
  }

  const hebrew = /[֐-׿]/

  it('has no untranslated Hebrew left in the English dictionary', () => {
    const leftovers = entries(en).filter(([, text]) => hebrew.test(text))
    // The language picker names each language in its own script, so that one
    // Hebrew string in the English dictionary is correct.
    expect(leftovers.map(([path]) => path)).toEqual([])
  })

  it('has Hebrew text in the Hebrew dictionary', () => {
    const translated = entries(he).filter(([, text]) => hebrew.test(text))
    expect(translated.length).toBeGreaterThan(40)
  })

  it('covers the same keys in both, including the nested ones', () => {
    expect(entries(en).map(([path]) => path).sort()).toEqual(entries(he).map(([path]) => path).sort())
  })
})

describe('language metadata', () => {
  it('maps each language to its writing direction', () => {
    expect(directionOf('he')).toBe('rtl')
    expect(directionOf('en')).toBe('ltr')
  })

  it('rejects anything that is not a supported language', () => {
    expect(LANGUAGES.every(isLanguage)).toBe(true)
    expect(isLanguage('fr')).toBe(false)
    expect(isLanguage(null)).toBe(false)
    expect(isLanguage(undefined)).toBe(false)
  })
})

describe('counting in Hebrew', () => {
  // The dual form is the thing a naive translation gets wrong.
  it('uses the dual form for two', () => {
    expect(days(2, 'he')).toBe('יומיים')
    expect(days(1, 'he')).toBe('יום')
    expect(days(3, 'he')).toBe('3 ימים')
  })

  it('inflects tasks and points by number', () => {
    expect(tasksWord(1, 'he')).toBe('משימה אחת')
    expect(tasksWord(4, 'he')).toBe('4 משימות')
    expect(pointsWord(1, 'he')).toBe('נקודה אחת')
    expect(pointsWord(5, 'he')).toBe('5 נקודות')
  })
})

describe('counting in English', () => {
  it('pluralises normally', () => {
    expect(days(1, 'en')).toBe('1 day')
    expect(days(2, 'en')).toBe('2 days')
    expect(tasksWord(1, 'en')).toBe('1 task')
    expect(tasksWord(2, 'en')).toBe('2 tasks')
    expect(pointsWord(1, 'en')).toBe('1 point')
    expect(pointsWord(2, 'en')).toBe('2 points')
  })
})

describe('the dictionaries produce sentences, not fragments', () => {
  it('builds the "needs action" summary in both languages', () => {
    expect(he.today.needsAction(1)).toBe('משימה אחת ממתינה')
    expect(he.today.needsAction(3)).toBe('3 משימות ממתינות')
    expect(en.today.needsAction(1)).toBe('1 task needs action')
    expect(en.today.needsAction(3)).toBe('3 tasks need action')
  })

  it('builds the late badge in both languages', () => {
    expect(he.task.badgeLate(2)).toBe('איחור של יומיים')
    expect(en.task.badgeLate(2)).toBe('2 days late')
  })

  it('builds the points-earned toast in both languages', () => {
    expect(he.points.earned(10)).toBe('+10 נקודות!')
    expect(en.points.earned(10)).toBe('+10 points!')
  })
})

describe('the reminder notification', () => {
  // Composed on the server, potentially hours after the app was last open,
  // which is why the language has to be stored rather than read from a
  // browser.
  it('names the tasks and how late they are, in Hebrew', () => {
    const { title, body } = composeReminder(
      [
        { name: 'לשטוף כלים', daysLate: 2 },
        { name: 'לקפל כביסה', daysLate: 0 },
      ],
      'he',
    )
    expect(title).toBe('איחור של יומיים · 2 משימות')
    expect(body).toBe('לשטוף כלים (יומיים איחור), לקפל כביסה')
  })

  it('says the same thing in English', () => {
    const { title, body } = composeReminder(
      [
        { name: 'Wash dishes', daysLate: 2 },
        { name: 'Fold laundry', daysLate: 0 },
      ],
      'en',
    )
    expect(title).toBe('2 days late · 2 tasks')
    expect(body).toBe('Wash dishes (2 days late), Fold laundry')
  })

  it('drops the lateness clause when nothing is overdue', () => {
    expect(composeReminder([{ name: 'Water the plants', daysLate: 0 }], 'en')).toEqual({
      title: 'Time for a task · 1 task',
      body: 'Water the plants',
    })
    expect(composeReminder([{ name: 'לסדר את הסלון', daysLate: 0 }], 'he').title).toBe(
      'הגיע הזמן למשימה · משימה אחת',
    )
  })

  it('prefixes the space name only when the person is in more than one', () => {
    const { body } = composeReminder([{ name: 'Take out trash', spaceName: 'Office', daysLate: 1 }], 'en')
    expect(body).toBe('Office: Take out trash')
  })

  it('does not repeat the lateness in the body for a single task - the title already says it', () => {
    const { title, body } = composeReminder([{ name: 'Clean the bathroom', daysLate: 1 }], 'en')
    expect(title).toBe('1 day late · 1 task')
    expect(body).toBe('Clean the bathroom')
  })

  it('does not repeat the lateness per task when every task is equally late', () => {
    const { body } = composeReminder(
      [
        { name: 'Wash dishes', daysLate: 2 },
        { name: 'Fold laundry', daysLate: 2 },
      ],
      'en',
    )
    expect(body).toBe('Wash dishes, Fold laundry')
  })

  it('truncates a long list rather than filling the notification tray', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ name: `Task ${i}`, daysLate: 0 }))
    expect(composeReminder(many, 'en').body).toBe('Task 0, Task 1, Task 2, Task 3 +3 more')
    expect(composeReminder(many, 'he').body).toContain('ועוד 3')
  })
})

describe('the time-limited task reminder', () => {
  it('names the task and its window end, in both languages', () => {
    expect(composeTimeLimitedReminder('Buy milk', '20:00', 'en')).toEqual({
      title: 'Buy milk',
      body: 'Still open - valid until 20:00',
    })
    expect(composeTimeLimitedReminder('לקנות חלב', '20:00', 'he')).toEqual({
      title: 'לקנות חלב',
      body: 'עדיין פתוחה · בתוקף עד 20:00',
    })
  })
})
