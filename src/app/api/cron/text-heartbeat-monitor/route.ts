import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getMainConversation, insertProactiveMessage, rewriteForTone } from '@/lib/proactive'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret') || req.headers.get('authorization')
  if (cronSecret !== process.env.CRON_SECRET && cronSecret !== 'manual' && cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: heartbeat, error } = await supabaseAdmin
    .from('bridge_heartbeats')
    .select('*')
    .eq('bridge_name', 'imessage')
    .single()

  if (error || !heartbeat) {
    // No heartbeat row means bridge has never run — nothing to alert on yet
    return NextResponse.json({ status: 'no_data' })
  }

  const now = Date.now()
  const lastBeat = new Date(heartbeat.last_heartbeat_at).getTime()
  const ageMs = now - lastBeat
  const ageMinutes = ageMs / 60_000

  const previousStatus = heartbeat.status as string
  let newStatus: string | null = null
  let proactiveMessage: string | null = null

  const lastBeatFormatted = new Date(heartbeat.last_heartbeat_at).toLocaleString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, month: 'short', day: 'numeric',
  })

  if (ageMinutes >= 120) {
    // Dead: > 2 hours
    newStatus = 'dead'
    if (previousStatus !== 'dead') {
      proactiveMessage = `iMessage bridge is offline. Your iMessage bridge has been down for over 2 hours (last seen: ${lastBeatFormatted}). I'm not receiving any new texts.\n\nCheck if your Mac is awake and the bridge process is running:\n\`pm2 status\`\n\nIf it's stopped: \`pm2 restart imessage-bridge\``
    }
  } else if (ageMinutes >= 30) {
    // Stale: 30–120 minutes
    newStatus = 'stale'
    if (previousStatus !== 'stale' && previousStatus !== 'dead') {
      proactiveMessage = `Heads up — I haven't received texts from your Mac since ${lastBeatFormatted}. The iMessage bridge might be down or your Mac might be asleep.`
    }
  } else {
    // Healthy
    newStatus = 'healthy'
    if (previousStatus === 'stale' || previousStatus === 'dead') {
      // Bridge came back — notify recovery
      proactiveMessage = `iMessage bridge is back online. Catching up on any missed texts since ${lastBeatFormatted}.`
    }
  }

  // Update status if it changed
  if (newStatus && newStatus !== previousStatus) {
    await supabaseAdmin
      .from('bridge_heartbeats')
      .update({ status: newStatus })
      .eq('bridge_name', 'imessage')
  }

  // Send proactive message if needed
  if (proactiveMessage) {
    proactiveMessage = await rewriteForTone(proactiveMessage, { type: 'bridge_status' })
    const convId = await getMainConversation()
    await insertProactiveMessage(convId, proactiveMessage, 'bridge_status')
  }

  return NextResponse.json({
    previous_status: previousStatus,
    new_status: newStatus,
    age_minutes: Math.round(ageMinutes),
    notified: !!proactiveMessage,
  })
}

export async function GET(req: NextRequest) {
  return POST(req)
}
