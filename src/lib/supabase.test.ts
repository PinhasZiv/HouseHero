import { describe, expect, it } from 'vitest'
import { normalizeSupabaseUrl } from './supabase'

// This exists because of a real setup mistake: Supabase's dashboard shows
// "Project URL" directly above "REST API URL" (which already ends in
// /rest/v1), and pasting the wrong one breaks every request in a way that
// gives no hint the URL itself is the problem - supabase-js just appends its
// own path onto whatever it is given.

describe('normalizeSupabaseUrl', () => {
  it('leaves a correct project URL untouched', () => {
    expect(normalizeSupabaseUrl('https://abcdefgh.supabase.co')).toBe('https://abcdefgh.supabase.co')
  })

  it('strips a pasted REST API URL down to the project URL', () => {
    expect(normalizeSupabaseUrl('https://abcdefgh.supabase.co/rest/v1/')).toBe('https://abcdefgh.supabase.co')
    expect(normalizeSupabaseUrl('https://abcdefgh.supabase.co/rest/v1')).toBe('https://abcdefgh.supabase.co')
  })

  it('strips the other Supabase API paths the same way', () => {
    expect(normalizeSupabaseUrl('https://abcdefgh.supabase.co/auth/v1/')).toBe('https://abcdefgh.supabase.co')
    expect(normalizeSupabaseUrl('https://abcdefgh.supabase.co/realtime/v1')).toBe('https://abcdefgh.supabase.co')
    expect(normalizeSupabaseUrl('https://abcdefgh.supabase.co/storage/v1/')).toBe('https://abcdefgh.supabase.co')
  })

  it('drops a bare trailing slash even without an API path', () => {
    expect(normalizeSupabaseUrl('https://abcdefgh.supabase.co/')).toBe('https://abcdefgh.supabase.co')
  })

  it('leaves an unfilled placeholder as-is, for isConfigured to catch', () => {
    expect(normalizeSupabaseUrl('PASTE_YOUR_SUPABASE_URL_HERE')).toBe('PASTE_YOUR_SUPABASE_URL_HERE')
  })
})
