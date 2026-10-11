import { createClient } from '@supabase/supabase-js'

// Deliberately NOT createBrowserClient() from @supabase/ssr — that helper
// is a singleton: call it more than once, even with a different URL/key,
// and it silently returns the FIRST client ever created (see
// supabase/auth-helpers#743). That's what was sending every Stock Master
// read to the main app's project instead of this one. Plain createClient()
// has no such caching and is also correct here since this project is
// read-only via the anon key and never needs auth/cookie syncing.
export const masterSupabase = createClient(
  process.env.NEXT_PUBLIC_MASTER_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_MASTER_SUPABASE_ANON_KEY!
)