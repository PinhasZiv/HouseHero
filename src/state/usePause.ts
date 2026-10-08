import * as api from '../lib/api'
import { useI18n } from '../lib/i18n'
import type { Pause } from '../lib/pauses'
import { useToast } from '../components/Toast'
import { useApp } from './AppState'

/** Switching vacation mode on and off - see 0013_pauses.sql for the rules. */
export function usePause() {
  const { patchPause, reload } = useApp()
  const { t } = useI18n()
  const toast = useToast()

  async function start(spaceId: string, wholeSpace: boolean): Promise<void> {
    try {
      patchPause(await api.startPause(spaceId, wholeSpace))
      toast.show(wholeSpace ? t.vacation.startedSpace : t.vacation.started)
    } catch (cause) {
      toast.showError(cause)
    }
  }

  async function end(pause: Pause): Promise<void> {
    try {
      patchPause(await api.endPause(pause.id))
      // The server just moved the frozen tasks' due dates to today; realtime
      // delivers those too, but a reload makes it certain before anyone acts.
      await reload()
      toast.show(t.vacation.ended)
    } catch (cause) {
      toast.showError(cause)
    }
  }

  return { start, end }
}
