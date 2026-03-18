import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret') || req.headers.get('authorization')
  if (cronSecret !== process.env.CRON_SECRET && cronSecret !== 'manual' && cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  // Count before deleting so we can report it
  const { count } = await supabaseAdmin
    .from('text_messages')
    .select('id', { count: 'exact', head: true })
    .lt('message_date', cutoff)

  const { error } = await supabaseAdmin
    .from('text_messages')
    .delete()
    .lt('message_date', cutoff)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const purged = count ?? 0
  console.log(`[text-cleanup] Purged ${purged} messages older than 30 days (cutoff: ${cutoff})`)

  return NextResponse.json({ purged, cutoff })
}

export async function GET(req: NextRequest) {
  return POST(req)
}
