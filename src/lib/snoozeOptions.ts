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
 * Formats a Date for an `<input type="datetime-local">` value: local
 * wall-clock fields only, no timezone suffix - the browser already renders
 * and edits it in local time, so nothing here should re-encode a timezone.
 */
export function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
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
