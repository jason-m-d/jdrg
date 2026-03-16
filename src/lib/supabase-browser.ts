import { createClient, SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient<any, 'public', any> | null = null

export function getSupabaseBrowser() {
  if (!client) {
    client = createClient<any>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }
  return client
}
