// Pure helpers behind the snooze duration picker - kept separate from
// SnoozeSheet.tsx so they can be unit tested without a browser or React.

/** The three quick-pick durations, and which i18n label each one uses. */
export const SNOOZE_PRESETS = [
  { minutes: 30, labelKey: 'thirtyMinutes' },
  { minutes: 60, labelKey: 'oneHour' },
  { minutes: 180, labelKey: 'threeHours' },
] as const

export type SnoozePresetKey = (typeof SNOOZE_PRESETS)[number]['labelKey']

/** `now + minutes`, as an ISO instant ready to send to the server. */
export function snoozeUntilInMinutes(minutes: number, now: Date = new Date()): string {
  return new Date(now.getTime() + minutes * 60_000).toISOString()
}

/**
 * Whether a chosen custom instant is actually usable: parses (a
 * `datetime-local` value with no timezone is read as local time, exactly
 * like `toDatetimeLocalValue` writes it) and must land in the future.
 */
export function isValidSnoozeInstant(value: string, now: Date = new Date()): boolean {
  const asDate = new Date(value)
  return !Number.isNaN(asDate.getTime()) && asDate.getTime() > now.getTime()
}

/** Wall-clock times, unlike the relative presets above - "back to it this
 *  evening" or "tomorrow morning" is how people actually put a chore off. */
export const EVENING_HOUR = 20
export const MORNING_HOUR = 8

/**
 * The fixed-time snoozes worth offering right now, in this device's local
 * time. "This evening" disappears once it is close enough (half an hour
 * before) to be no better than the one-hour preset. "Morning" is the next
 * 08:00 at least half an hour away - at 00:30 that is the same calendar day,
 * which is what "in the morning" means to someone still up past midnight.
 */
export function fixedTimeSnoozes(now: Date = new Date()): { labelKey: 'tonight' | 'morning'; until: string }[] {
  const options: { labelKey: 'tonight' | 'morning'; until: string }[] = []
  const minimumMs = 30 * 60_000
  const evening = new Date(now.getFullYear(), now.getMonth(), now.getDate(), EVENING_HOUR, 0)
  if (evening.getTime() - now.getTime() >= minimumMs) {
    options.push({ labelKey: 'tonight', until: evening.toISOString() })
  }
  let morning = new Date(now.getFullYear(), now.getMonth(), now.getDate(), MORNING_HOUR, 0)
  if (morning.getTime() - now.getTime() < minimumMs) {
    morning = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, MORNING_HOUR, 0)
  }
  options.push({ labelKey: 'morning', until: morning.toISOString() })
  return options
}
