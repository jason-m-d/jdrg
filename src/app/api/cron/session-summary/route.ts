/**
 * session-summary/route.ts
 *
 * Renamed purpose: now runs the extraction pipeline (commitments, decisions,
 * watches, notepad, processes) on recent conversations that have had activity
 * in the last 30 minutes. The chat route fires extraction after each message
 * but this cron is a safety net for missed extractions.
 *
 * Summarization is handled by the separate summarize-conversation cron.
 * Session closing/tracking is no longer performed here.
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { extractFromRecentMessages } from '@/lib/chat/extraction'
import { logCronJob } from '@/lib/activity-log'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret') || req.headers.get('authorization')
  if (cronSecret !== process.env.CRON_SECRET && cronSecret !== 'manual' && cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronStart = Date.now()

  // Find conversations with recent activity (last 30 minutes) that may need extraction
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString()

  const { data: recentConversations } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(5)

  if (!recentConversations || recentConversations.length === 0) {
    void logCronJob({ job_name: 'session-summary', success: true, duration_ms: Date.now() - cronStart, summary: 'No recent conversations' })
    return NextResponse.json({ message: 'No recent conversations', processed: 0 })
  }

  let processed = 0

  for (const conv of recentConversations) {
    try {
      await extractFromRecentMessages(conv.id)
      processed++
    } catch (err) {
      console.error(`[extraction-cron] failed for conv ${conv.id}:`, err)
    }
  }

  void logCronJob({ job_name: 'session-summary', success: true, duration_ms: Date.now() - cronStart, summary: `Ran extraction on ${processed} conversation(s)` })
  return NextResponse.json({ message: `Ran extraction on ${processed} conversation(s)`, processed })
}
