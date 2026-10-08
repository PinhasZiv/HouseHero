import { describe, expect, it } from 'vitest'
import {
  composeWeeklySummary,
  isSummaryTime,
  summarizeSpaceWeek,
  weekStart,
  type SummaryCompletion,
} from '../../supabase/functions/_shared/weeklySummary.ts'

// 2026-10-10 is a Saturday.
const SATURDAY = '2026-10-10'

function row(overrides: Partial<SummaryCompletion>): SummaryCompletion {
  return { space_id: 'home', user_id: 'me', points_awarded: 5, completed_on: SATURDAY, completion_group: null, ...overrides }
}

describe('isSummaryTime', () => {
  it('is on Saturday from 20:00, within the window', () => {
    expect(isSummaryTime(SATURDAY, 20 * 60, 60)).toBe(true)
    expect(isSummaryTime(SATURDAY, 20 * 60 + 59, 60)).toBe(true)
  })

  it('is not before 20:00, after the window, or on another day', () => {
    expect(isSummaryTime(SATURDAY, 19 * 60 + 59, 60)).toBe(false)
    expect(isSummaryTime(SATURDAY, 21 * 60, 60)).toBe(false)
    expect(isSummaryTime('2026-10-09', 20 * 60, 60)).toBe(false)
  })
})

describe('summarizeSpaceWeek', () => {
  it('covers the seven days ending on the summary day, in that space only', () => {
    expect(weekStart(SATURDAY)).toBe('2026-10-04')
    const rows = [
      row({ completed_on: '2026-10-04' }),
      row({ completed_on: '2026-10-03' }), // last week
      row({ space_id: 'cabin' }),
    ]
    expect(summarizeSpaceWeek(rows, 'home', 'me', SATURDAY).total).toBe(1)
  })

  it('counts a together completion once, but credits each person', () => {
    const rows = [
      row({ user_id: 'me', completion_group: 'g1' }),
      row({ user_id: 'dana', completion_group: 'g1' }),
      row({ user_id: 'dana', points_awarded: 10 }),
    ]
    expect(summarizeSpaceWeek(rows, 'home', 'me', SATURDAY)).toEqual({
      spaceId: 'home', total: 2, mine: 1, myPoints: 5, topUserId: 'dana',
    })
  })

  it('has no leader in a quiet week', () => {
    expect(summarizeSpaceWeek([], 'home', 'me', SATURDAY)).toEqual({
      spaceId: 'home', total: 0, mine: 0, myPoints: 0, topUserId: null,
    })
  })
})

describe('composeWeeklySummary', () => {
  it('reads naturally in Hebrew', () => {
    const { title, body } = composeWeeklySummary(
      [{ total: 12, mine: 5, myPoints: 40, topName: 'דנה', topIsYou: false }],
      'he',
    )
    expect(title).toBe('הסיכום השבועי')
    expect(body).toBe("בוצעו השבוע 12 משימות, 5 מהן על ידך (+40 נק'). בראש הטבלה: דנה.")
  })

  it('celebrates the leader and names each space when there are several', () => {
    const { body } = composeWeeklySummary(
      [
        { spaceName: 'הבית', total: 3, mine: 3, myPoints: 15, topName: 'אני', topIsYou: true },
        { spaceName: 'הצימר', total: 0, mine: 0, myPoints: 0, topName: null, topIsYou: false },
      ],
      'he',
    )
    expect(body).toBe("הבית: בוצעו השבוע 3 משימות, 3 מהן על ידך (+15 נק'). המקום הראשון השבוע שלך!\nהצימר: שבוע שקט - לא בוצעו משימות.")
  })

  it('has an English version', () => {
    const { title, body } = composeWeeklySummary(
      [{ total: 1, mine: 0, myPoints: 0, topName: 'Dana', topIsYou: false }],
      'en',
    )
    expect(title).toBe('Your week in HouseHero')
    expect(body).toBe('1 task done. Top of the week: Dana.')
  })
})
