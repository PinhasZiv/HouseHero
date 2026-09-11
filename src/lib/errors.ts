/**
 * Supabase throws plain error objects - PostgrestError, AuthError - rather
 * than Error instances, so `cause instanceof Error` is false for them and
 * `String(cause)` renders as the useless "[object Object]". This pulls the
 * readable `.message` off anything error-shaped instead.
 */
export function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  if (
    typeof cause === 'object' &&
    cause !== null &&
    'message' in cause &&
    typeof (cause as { message: unknown }).message === 'string'
  ) {
    return (cause as { message: string }).message
  }
  return String(cause)
}
