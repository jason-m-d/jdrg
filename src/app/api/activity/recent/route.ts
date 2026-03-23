import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('crosby_events')
    .select('payload, created_at')
    .eq('event_type', 'cron_job')
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) {
    console.error('[activity/recent] query failed:', error)
    return NextResponse.json({ event: null })
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ event: null })
  }

  const row = data[0]
  return NextResponse.json({
    event: {
      summary: row.payload?.summary ?? '',
      job_name: row.payload?.job_name ?? '',
      created_at: row.created_at,
    },
  })
}
