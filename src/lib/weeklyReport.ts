// Re-exported so app code can import the weekly report without reaching into
// the Supabase functions folder - the Saturday-evening push builds the same one.
export * from '../../supabase/functions/_shared/weeklyReport.ts'
