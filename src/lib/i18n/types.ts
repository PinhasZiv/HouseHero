/** The languages the interface is available in. */
export type Language = 'he' | 'en'

export const LANGUAGES: Language[] = ['he', 'en']

/** Right-to-left is a property of the language, not a separate setting. */
export function directionOf(language: Language): 'rtl' | 'ltr' {
  return language === 'he' ? 'rtl' : 'ltr'
}

/** What each language calls itself, for the picker. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  he: 'עברית',
  en: 'English',
}

export function isLanguage(value: unknown): value is Language {
  return value === 'he' || value === 'en'
}

/**
 * The language to start in when nobody has chosen yet. Someone invited from
 * abroad should not land on a Hebrew screen, and vice versa.
 */
export function detectLanguage(): Language {
  const candidates = typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]
  return candidates.some((tag) => tag?.toLowerCase().startsWith('he')) ? 'he' : 'en'
}
