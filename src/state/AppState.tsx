import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { errorMessage } from '../lib/errors'
import { getLanguage, isLanguage, setLanguage } from '../lib/i18n'
import { restorePushIfGranted } from '../lib/push'
import { reconcileReloadedTasks } from '../lib/reconcileTasks'
import { COLD_START_RETRY_DELAYS_MS, withRetry } from '../lib/retry'
import { supabase } from '../lib/supabase'
import { todayIn } from '../lib/taskDue'
import * as api from '../lib/api'
import type { Profile, Space, Task } from '../lib/types'

type Person = Pick<
  Profile,
  'id' | 'display_name' | 'avatar_url' | 'email' | 'lifetime_points' | 'spendable_points'
>

/** One person's own reminder time for one task, overriding the task's own. */
export interface ReminderOverride {
  hour: number
  minute: number
}

interface AppContextValue {
  session: Session | null
  profile: Profile | null
  spaces: Space[]
  tasks: Task[]
  /** Everyone the user shares a space with, by user id - names and points. */
  people: Map<string, Person>
  /** Today's date in the signed-in person's timezone, as `YYYY-MM-DD`. */
  today: string
  currentSpaceId: string | null
  setCurrentSpaceId: (id: string) => void
  currentSpace: Space | null
  loading: boolean
  error: string | null
  reload: () => Promise<void>
  setProfile: (profile: Profile) => void
  /** Applies a task change locally so the UI does not wait for a round trip. */
  patchTask: (task: Task) => void
  removeTask: (taskId: string) => void
  /**
   * This person's own snoozes, by task id, mapping to `snoozed_until`. A task
   * with no entry here is not snoozed.
   */
  snoozes: Map<string, string>
  /** Applies a snooze (or its cancellation, with `until: null`) locally. */
  patchSnooze: (taskId: string, until: string | null) => void
  /**
   * This person's own reminder-time overrides, by task id. A task with no
   * entry here is reminded at its own reminder_hour/minute, like everyone
   * else in the space.
   */
  reminderOverrides: Map<string, ReminderOverride>
  /** Applies an override (or clears it, with `override: null`) locally. */
  patchReminderOverride: (taskId: string, override: ReminderOverride | null) => void
}

const AppContext = createContext<AppContextValue | null>(null)

const SPACE_KEY = 'househero.currentSpace'

function readStoredSpace(): string | null {
  // A notification carries the space it is about; honour that over whatever
  // was last open, so tapping a reminder lands on the right list.
  const fromUrl = new URLSearchParams(window.location.search).get('space')
  if (fromUrl) return fromUrl
  try {
    return localStorage.getItem(SPACE_KEY)
  } catch {
    return null
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [spaces, setSpaces] = useState<Space[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [people, setPeople] = useState<Map<string, Person>>(new Map())
  const [snoozes, setSnoozes] = useState<Map<string, string>>(new Map())
  const [reminderOverrides, setReminderOverrides] = useState<Map<string, ReminderOverride>>(new Map())
  const [currentSpaceId, setCurrentSpaceIdState] = useState<string | null>(readStoredSpace)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [today, setToday] = useState(() => todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone))

  // Task ids the realtime channel has patched in since the current reload()
  // started - see reconcileReloadedTasks for why reload() needs this.
  const touchedTaskIdsRef = useRef<Set<string>>(new Set())

  const timezone = profile?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const userId = session?.user.id ?? null

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthReady(true)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setAuthReady(true)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  const adoptLanguage = useCallback((loaded: Profile) => {
    if (isLanguage(loaded.language)) {
      setLanguage(loaded.language)
      return
    }
    const local = getLanguage()
    void supabase
      .from('profiles')
      .update({ language: local })
      .eq('id', loaded.id)
      .then(({ error: cause }) => {
        if (cause) console.error('could not record the language preference', cause)
      })
  }, [])

  const reload = useCallback(async () => {
    if (!userId) return
    setError(null)
    touchedTaskIdsRef.current = new Set()
    const fetchEverything = () =>
      Promise.all([
        api.fetchProfile(userId),
        api.fetchSpaces(),
        api.fetchAllTasks(),
        api.fetchPeople(),
        api.fetchSnoozes(userId),
        api.fetchReminderOverrides(userId),
      ])
    try {
      // A cold start (opening the PWA after it sat backgrounded, or from
      // fully closed) can race the very first request against a session
      // token that is still being refreshed, or a network interface that has
      // not woken up yet - a WiFi/LTE handoff, or a spotty connection still
      // recovering, can take several seconds, not just one. That clears up
      // on its own, which is all "press try again" ever did, so this retries
      // silently rather than making it a manual step.
      const result = await withRetry(fetchEverything, COLD_START_RETRY_DELAYS_MS)
      const [nextProfile, nextSpaces, nextTasks, nextPeople, nextSnoozes, nextReminderOverrides] = result
      setProfile(nextProfile)
      adoptLanguage(nextProfile)
      setSpaces(nextSpaces)
      setTasks((current) => reconcileReloadedTasks(current, nextTasks, touchedTaskIdsRef.current))
      setPeople(new Map(nextPeople.map((person) => [person.id, person])))
      setSnoozes(new Map(nextSnoozes.map((row) => [row.task_id, row.snoozed_until])))
      setReminderOverrides(
        new Map(nextReminderOverrides.map((row) => [row.task_id, { hour: row.reminder_hour, minute: row.reminder_minute }])),
      )
      setCurrentSpaceIdState((current) => {
        const stillValid = current && nextSpaces.some((space) => space.id === current)
        return stillValid ? current : (nextSpaces[0]?.id ?? null)
      })
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [userId, adoptLanguage])

  // The date has to be re-derived rather than captured once: the app is meant
  // to stay open, and a list that still says "today" after midnight would be
  // lying.
  useEffect(() => {
    const tick = () => setToday(todayIn(timezone))
    tick()
    const interval = window.setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [timezone])

  useEffect(() => {
    if (!authReady) return
    if (!userId) {
      setLoading(false)
      setProfile(null)
      setSpaces([])
      setTasks([])
      setPeople(new Map())
      setSnoozes(new Map())
      setReminderOverrides(new Map())
      return
    }
    setLoading(true)
    void reload()
  }, [authReady, userId, reload])

  // Live updates: the point of a shared space is that when someone else
  // completes a task, it updates on your screen without you doing anything.
  useEffect(() => {
    if (!userId) return
    const channel = supabase
      .channel('tasks-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const removedId = (payload.old as Task).id
          touchedTaskIdsRef.current.add(removedId)
          setTasks((current) => current.filter((task) => task.id !== removedId))
        } else {
          const incoming = payload.new as Task
          touchedTaskIdsRef.current.add(incoming.id)
          setTasks((current) => {
            const without = current.filter((task) => task.id !== incoming.id)
            return [...without, incoming]
          })
        }
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [userId])

  // Same idea for points: an approved redemption (or a completion) changes a
  // profiles row that is not necessarily this device's own fetch.
  useEffect(() => {
    if (!userId) return
    const channel = supabase
      .channel('profiles-sync')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, (payload) => {
        const incoming = payload.new as Profile
        setPeople((current) => {
          const existing = current.get(incoming.id)
          if (!existing) return current
          const next = new Map(current)
          next.set(incoming.id, {
            ...existing,
            lifetime_points: incoming.lifetime_points,
            spendable_points: incoming.spendable_points,
          })
          return next
        })
        if (incoming.id === userId) setProfile((current) => (current ? { ...current, ...incoming } : current))
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [userId])

  // Membership changes are rarer and not worth a second realtime channel, but a
  // refresh on returning to the app catches "someone added me to a space".
  const lastRefresh = useRef(Date.now())
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !userId) return
      if (Date.now() - lastRefresh.current < 30_000) return
      lastRefresh.current = Date.now()
      void reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [userId, reload])

  // A device can wipe the push subscription along with the sign-in session
  // while leaving the OS notification permission granted. If so, this
  // silently re-subscribes - no prompt, since permission is already decided -
  // the moment a session comes back.
  useEffect(() => {
    if (!userId) return
    void restorePushIfGranted(userId)
  }, [userId])

  const setCurrentSpaceId = useCallback((id: string) => {
    setCurrentSpaceIdState(id)
    try {
      localStorage.setItem(SPACE_KEY, id)
    } catch {
      // Private browsing with storage blocked; the choice just will not persist.
    }
  }, [])

  const patchTask = useCallback((task: Task) => {
    setTasks((current) => current.map((item) => (item.id === task.id ? task : item)))
  }, [])

  const removeTask = useCallback((taskId: string) => {
    setTasks((current) => current.filter((item) => item.id !== taskId))
  }, [])

  const patchSnooze = useCallback((taskId: string, until: string | null) => {
    setSnoozes((current) => {
      const next = new Map(current)
      if (until) next.set(taskId, until)
      else next.delete(taskId)
      return next
    })
  }, [])

  const patchReminderOverride = useCallback((taskId: string, override: ReminderOverride | null) => {
    setReminderOverrides((current) => {
      const next = new Map(current)
      if (override) next.set(taskId, override)
      else next.delete(taskId)
      return next
    })
  }, [])

  const value = useMemo<AppContextValue>(
    () => ({
      session,
      profile,
      spaces,
      tasks,
      people,
      today,
      currentSpaceId,
      setCurrentSpaceId,
      currentSpace: spaces.find((space) => space.id === currentSpaceId) ?? null,
      loading: loading || !authReady,
      error,
      reload,
      setProfile,
      patchTask,
      removeTask,
      snoozes,
      patchSnooze,
      reminderOverrides,
      patchReminderOverride,
    }),
    [
      session, profile, spaces, tasks, people, today, currentSpaceId,
      setCurrentSpaceId, loading, authReady, error, reload, patchTask, removeTask,
      snoozes, patchSnooze, reminderOverrides, patchReminderOverride,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp must be used inside AppProvider')
  return value
}
