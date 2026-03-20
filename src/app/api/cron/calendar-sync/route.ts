import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchUpcomingEvents } from '@/lib/calendar'
import { logCronJob } from '@/lib/activity-log'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  // Validate secret (cron or manual)
  const cronSecret = req.headers.get('x-cron-secret') || req.headers.get('authorization')
  if (cronSecret !== process.env.CRON_SECRET && cronSecret !== 'manual' && cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronStart = Date.now()

  // Get all connected calendar accounts
  const { data: accounts } = await supabaseAdmin.from('calendar_tokens').select('account')
  if (!accounts || accounts.length === 0) {
    void logCronJob({ job_name: 'calendar-sync', success: true, duration_ms: Date.now() - cronStart, summary: 'No calendar accounts connected' })
    return NextResponse.json({ message: 'No calendar accounts connected', events_synced: 0 })
  }

  let totalSynced = 0

  for (const { account } of accounts) {
    try {
      // Fetch events for next 7 days
      const now = new Date()
      const timeMin = now.toISOString()
      const timeMax = new Date(now.getTime() + 7 * 24 * 3600000).toISOString()

      console.log(`[calendar-sync] ${account}: fetching events ${timeMin} to ${timeMax}`)

      const events = await fetchUpcomingEvents(account, timeMin, timeMax)
      console.log(`[calendar-sync] ${account}: fetched ${events.length} events`)

      // Track which google_event_ids came back from the API
      const fetchedEventIds = new Set<string>()

      // Upsert each event
      for (const evt of events) {
        fetchedEventIds.add(evt.id)

        const { error } = await supabaseAdmin.from('calendar_events').upsert({
          account,
          google_event_id: evt.id,
          calendar_id: evt.calendarId,
          title: evt.title,
          description: evt.description,
          start_time: evt.startTime,
          end_time: evt.endTime,
          location: evt.location,
          attendees: evt.attendees,
          all_day: evt.allDay,
          recurring_event_id: evt.recurringEventId,
          status: evt.status,
          organizer_email: evt.organizerEmail,
          synced_at: new Date().toISOString(),
        }, { onConflict: 'account,google_event_id' })

        if (error) {
          console.error(`[calendar-sync] Upsert failed for event ${evt.id}: ${error.message}`)
        }
      }

      // Delete events in the sync window that are no longer in Google's response
      // (cancelled or removed events)
      const { data: storedEvents } = await supabaseAdmin
        .from('calendar_events')
        .select('id, google_event_id')
        .eq('account', account)
        .gte('start_time', timeMin)
        .lte('start_time', timeMax)

      if (storedEvents) {
        const toDelete = storedEvents.filter(e => !fetchedEventIds.has(e.google_event_id))
        if (toDelete.length > 0) {
          const deleteIds = toDelete.map(e => e.id)
          const { error: deleteError } = await supabaseAdmin
            .from('calendar_events')
            .delete()
            .in('id', deleteIds)

          if (deleteError) {
            console.error(`[calendar-sync] Delete failed: ${deleteError.message}`)
          } else {
            console.log(`[calendar-sync] ${account}: deleted ${toDelete.length} removed/cancelled events`)
          }
        }
      }

      // Update sync tracking
      await supabaseAdmin.from('calendar_syncs').upsert({
        account,
        last_synced_at: new Date().toISOString(),
        events_synced: events.length,
      }, { onConflict: 'account' })

      totalSynced += events.length
      console.log(`[calendar-sync] ${account}: sync complete, ${events.length} events`)

    } catch (e: any) {
      console.error(`[calendar-sync] SYNC_ERR name=${e.name}`)
      console.error(`[calendar-sync] SYNC_ERR msg=${e.message?.slice(0, 200)}`)
      console.error(`[calendar-sync] SYNC_ERR stack=${e.stack?.slice(0, 200)}`)
    }
  }

  void logCronJob({ job_name: 'calendar-sync', success: true, duration_ms: Date.now() - cronStart, summary: `Synced ${totalSynced} events across ${accounts.length} account(s)` })
  return NextResponse.json({ events_synced: totalSynced, accounts: accounts.length })
}

// Also support GET for Vercel Cron
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return POST(req)
}
