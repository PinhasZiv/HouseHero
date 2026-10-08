// Android's back button (and a browser's) walks the session history - and the
// app never added any, so back always left the app, even with a sheet open or
// on a tab other than Today.
//
// This keeps exactly one extra "guard" history entry for as long as anything
// back can close is open (sheets, a non-Today tab). Back consumes the guard,
// the topmost closer runs, and if something is still open the guard goes back
// up. One guard rather than one entry per sheet keeps the bookkeeping simple:
// a sheet closing and another opening in the same tick (the duplicate-task
// flow) never touches history at all.

export interface HistoryLike {
  pushState(data: unknown, unused: string): void
  back(): void
}

interface Closer {
  id: number
  onBack: () => void
}

export interface BackStack {
  /** Registers something back should close; returns its unregister. The most
   *  recently registered still-open closer is the one back closes. */
  register(onBack: () => void): () => void
  /** True when this closer is the one back (or Escape) would close now. */
  isTop(unregister: () => void): boolean
  /** Call from the window's popstate listener. */
  handlePopState(): void
}

export function createBackStack(history: HistoryLike, schedule: (run: () => void) => void): BackStack {
  const closers: Closer[] = []
  const ids = new WeakMap<() => void, number>()
  let nextId = 1
  let guardActive = false
  // A history.back() we issued ourselves to drop the guard - its popstate is
  // not the person pressing back.
  let pendingOwnBack = false
  let syncScheduled = false

  function sync() {
    syncScheduled = false
    if (pendingOwnBack) return // re-run once that popstate lands
    const wanted = closers.length > 0
    if (wanted && !guardActive) {
      history.pushState({ househeroGuard: true }, '')
      guardActive = true
    } else if (!wanted && guardActive) {
      guardActive = false
      pendingOwnBack = true
      history.back()
    }
  }

  function scheduleSync() {
    if (syncScheduled) return
    syncScheduled = true
    // Deferred so that a close and an open in the same tick net out to
    // nothing, instead of a back() racing a pushState().
    schedule(sync)
  }

  return {
    register(onBack) {
      const closer = { id: nextId++, onBack }
      closers.push(closer)
      const unregister = () => {
        const index = closers.indexOf(closer)
        if (index === -1) return
        closers.splice(index, 1)
        scheduleSync()
      }
      ids.set(unregister, closer.id)
      scheduleSync()
      return unregister
    },

    isTop(unregister) {
      const id = ids.get(unregister)
      return id !== undefined && closers.length > 0 && closers[closers.length - 1].id === id
    },

    handlePopState() {
      if (pendingOwnBack) {
        pendingOwnBack = false
        scheduleSync()
        return
      }
      if (!guardActive) return // a real navigation further back - not ours
      guardActive = false
      const top = closers[closers.length - 1]
      // The closer unregisters itself as it closes, which re-raises the guard
      // if something is still open underneath. Syncing here too covers a
      // closer that declined to close (busy mid-save): it stays registered,
      // so the guard goes back up instead of the next back leaving the app.
      if (top) top.onBack()
      scheduleSync()
    },
  }
}
