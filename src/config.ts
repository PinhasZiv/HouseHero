// ============================================================================
//  The only settings you need to fill in inside the app itself.
//
//  Both values are safe to publish. They already ship to every browser that
//  opens the app, and every table in the database is protected by Row Level
//  Security - the key alone grants access to nothing. Never put the
//  service_role key here.
//
//  Where to find them: Supabase -> Project Settings -> Data API
// ============================================================================

/**
 * Project URL - just the base address, no path at the end.
 * e.g. https://abcdefghijklmnop.supabase.co
 *
 * Supabase's Data API page shows two similar lines: "Project URL" above, and
 * "REST API URL" right below it, which already ends in /rest/v1/. Copy only
 * the first line - supabase-js appends its own paths, and a base URL that
 * already carries one breaks both sign-in and every database call.
 */
export const SUPABASE_URL = 'https://axamojjnbhygnclqihhe.supabase.co'

/** The public (anon / publishable) key. Starts with eyJ or sb_publishable_ */
export const SUPABASE_ANON_KEY = 'sb_publishable_pFs3YH-azLKt3ZeD7Pzq0Q_5WH6qNqe'

// ----------------------------------------------------------------------------
// Everything below this line is already set. No need to touch it.
// ----------------------------------------------------------------------------

/**
 * The public notification key (VAPID). Its private half lives in the
 * database, not in code. Changing this key invalidates every existing push
 * subscription.
 */
export const VAPID_PUBLIC_KEY =
  'BCyWeQPwL0wQSPWcWi1WBDVvzkHiU6Q8BIMi5w1BL5pwQAKGyBV1Ocl4lr00HRworVm0bXanVcvcKniK32FgL8c'

/** Stays false until the two values above are filled in. */
export const isConfigured =
  !SUPABASE_URL.startsWith('PASTE_') && !SUPABASE_ANON_KEY.startsWith('PASTE_')
