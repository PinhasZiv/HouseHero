import { useSyncExternalStore } from 'react'
import { en } from './en'
import { he, type Strings } from './he'
import { detectLanguage, directionOf, isLanguage, type Language } from './types'

// The active language, held outside React.
//
// A React context would be the usual answer, but the language is also needed
// by code that is not a component - the API layer turning a database error
// into a sentence, the push helper reporting why a test failed. A tiny store
// with a hook on top serves both without threading a parameter through every
// call, and useSyncExternalStore keeps the components correctly subscribed.

const STORAGE_KEY = 'househero.language'

const dictionaries: Record<Language, Strings> = { he, en }

let current: Language = readInitialLanguage()
const listeners = new Set<() => void>()

function readInitialLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isLanguage(stored)) return stored
  } catch {
    // Storage blocked (private browsing). Fall through to detection.
  }
  return detectLanguage()
}

export function getLanguage(): Language {
  return current
}

/** The active dictionary, for code that cannot use the hook. */
export function t(): Strings {
  return dictionaries[current]
}

/**
 * Puts the language on <html>, which is what actually flips the page to RTL
 * and tells the browser which hyphenation and font fallbacks to use.
 */
export function applyLanguageToDocument(): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = current
  document.documentElement.dir = directionOf(current)
}

/**
 * `remember: false` is for adopting the language stored on the profile: it
 * should change the screen, but not overwrite a choice this device made and
 * has not yet pushed up.
 */
export function setLanguage(next: Language, { remember = true } = {}): void {
  const changed = next !== current
  current = next

  if (remember) {
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Nothing to do; the choice just will not survive a reload.
    }
  }

  applyLanguageToDocument()
  if (changed) for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useI18n(): { language: Language; t: Strings; setLanguage: typeof setLanguage } {
  const language = useSyncExternalStore(subscribe, getLanguage, getLanguage)
  return { language, t: dictionaries[language], setLanguage }
}

export type { Strings }
export * from './types'
