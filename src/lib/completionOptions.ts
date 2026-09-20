// Pure helpers behind "log this for a different time" on the completion
// picker - kept separate from CompletionSheet.tsx so they can be unit tested
// without a browser or React, the same way snoozeOptions.ts already is.

/**
 * Whether a chosen custom instant is actually usable: parses (a
 * `datetime-local` value with no timezone is read as local time) and must
 * not be in the future - the mirror image of isValidSnoozeInstant, which
 * requires the opposite.
 */
export function isValidCompletionInstant(value: string, now: Date = new Date()): boolean {
  const asDate = new Date(value)
  return !Number.isNaN(asDate.getTime()) && asDate.getTime() <= now.getTime()
}
