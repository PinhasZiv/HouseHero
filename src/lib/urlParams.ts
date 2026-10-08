// One-shot parameters a notification opens the app with (?tab=, ?task=).
// Reading and stripping are separate on purpose: React may run a state
// initializer twice, so the read has to be side-effect free, and the strip
// happens once, from an effect.

export function readParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name)
}

/** Removes the parameter so a later reload does not act on it again. */
export function stripParam(name: string): void {
  const params = new URLSearchParams(window.location.search)
  if (!params.has(name)) return
  params.delete(name)
  const rest = params.toString()
  window.history.replaceState(window.history.state, '', window.location.pathname + (rest ? `?${rest}` : ''))
}
