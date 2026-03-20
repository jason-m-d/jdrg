'use client'

import { useState, useEffect, useCallback } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { Loader2, ChevronLeft, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import Link from 'next/link'

type EventType = 'chat_message' | 'cron_job' | 'background_job' | 'router_decision' | 'error' | 'nudge_decision'

interface CrosbyEvent {
  event_type: string
  occurred_at: string
  payload: Record<string, any>
}

const EVENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All events' },
  { value: 'chat_message', label: 'Chat messages' },
  { value: 'cron_job', label: 'Cron jobs' },
  { value: 'background_job', label: 'Background jobs' },
  { value: 'router_decision', label: 'Router decisions' },
  { value: 'nudge_decision', label: 'Nudge decisions' },
  { value: 'error', label: 'Errors' },
]

const TIME_RANGE_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: 'Last 1h' },
  { value: 6, label: 'Last 6h' },
  { value: 24, label: 'Last 24h' },
  { value: 168, label: 'Last 7d' },
]

const dotColor: Record<string, string> = {
  chat_message: 'bg-blue-500',
  cron_job: 'bg-green-500',
  background_job: 'bg-purple-500',
  router_decision: 'bg-yellow-500',
  error: 'bg-destructive',
  nudge_decision: 'bg-orange-500',
}

function summarizeEvent(event: CrosbyEvent): string {
  const p = event.payload
  switch (event.event_type) {
    case 'chat_message':
      return `${p.specialists?.join(', ') || 'core'} specialists, ${p.tools_called?.length ? `${p.tools_called.length} tools` : 'no tools called'}, ${p.latency_ms}ms${p.from_fallback ? ' (fallback router)' : ''}${p.is_error ? ' — ERROR' : ''}`
    case 'cron_job':
      return `${p.job_name}: ${p.success ? 'OK' : 'FAILED'} in ${p.duration_ms}ms — ${p.summary}`
    case 'background_job':
      return `${p.job_type}: ${p.success ? 'OK' : 'FAILED'} in ${p.duration_ms}ms (trigger: ${p.trigger_source})${p.error ? ` — ${p.error}` : ''}`
    case 'router_decision':
      return `"${(p.message_preview || '').slice(0, 60)}" → [${p.data_needed?.join(', ') || 'no data loaded'}]${p.from_fallback ? ' (fallback)' : ''} ${p.latency_ms}ms`
    case 'error':
      return `${p.route}: ${p.error_type} — ${p.error_message}`
    case 'nudge_decision':
      return `${p.sent ? 'sent' : 'skipped'} — ${p.reason} (${p.candidate_count} candidates)`
    default:
      return JSON.stringify(p).slice(0, 120)
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export default function LogsPage() {
  const [events, setEvents] = useState<CrosbyEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [eventTypeFilter, setEventTypeFilter] = useState('all')
  const [hoursBack, setHoursBack] = useState(24)
  const [refreshKey, setRefreshKey] = useState(0)

  const loadEvents = useCallback(async () => {
    setLoading(true)
    const cutoff = new Date(Date.now() - hoursBack * 3600000).toISOString()
    const { data } = await getSupabaseBrowser()
      .from('crosby_events')
      .select('event_type, occurred_at, payload')
      .gte('occurred_at', cutoff)
      .order('occurred_at', { ascending: false })
      .limit(200)
    setEvents(data || [])
    setLoading(false)
  }, [hoursBack, refreshKey])

  useEffect(() => { loadEvents() }, [loadEvents])

  const filtered = eventTypeFilter === 'all'
    ? events
    : events.filter(e => e.event_type === eventTypeFilter)

  return (
    <div className="max-w-2xl space-y-6 animate-in-fade">
      <div>
        <Link href="/settings" className="md:hidden inline-flex items-center gap-1 text-[0.75rem] text-muted-foreground/50 hover:text-foreground transition-colors mb-3">
          <ChevronLeft className="size-3" />Settings
        </Link>
        <h1 className="text-[0.8125rem] font-medium uppercase tracking-[0.1em] mb-1">Logs</h1>
        <p className="text-[0.75rem] text-muted-foreground/50">Crosby&apos;s activity history. Events are logged automatically.</p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={eventTypeFilter}
          onChange={(e) => setEventTypeFilter(e.target.value)}
          className="bg-transparent border border-border px-2.5 py-1.5 text-[0.75rem] text-muted-foreground outline-none focus:border-foreground/30 transition-colors"
        >
          {EVENT_TYPE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={hoursBack}
          onChange={(e) => setHoursBack(Number(e.target.value))}
          className="bg-transparent border border-border px-2.5 py-1.5 text-[0.75rem] text-muted-foreground outline-none focus:border-foreground/30 transition-colors"
        >
          {TIME_RANGE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          onClick={() => setRefreshKey(k => k + 1)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[0.75rem] border border-border text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="size-3" /> Refresh
        </button>
        {!loading && (
          <span className="text-[0.75rem] text-muted-foreground/40 ml-auto">{filtered.length} events</span>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-4 animate-spin text-muted-foreground/40" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-8 h-px bg-border mx-auto mb-4" />
          <p className="text-[0.8125rem] text-muted-foreground/60">No events found</p>
        </div>
      ) : (
        <div className="divide-y divide-border border border-border">
          {filtered.map((event, i) => (
            <div key={i} className="p-4 flex items-start gap-3">
              <div className="pt-0.5 shrink-0">
                <div className={cn('size-1.5', dotColor[event.event_type] || 'bg-muted-foreground/40')} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[0.625rem] uppercase tracking-wider text-muted-foreground/40">
                    {event.event_type.replace(/_/g, ' ')}
                  </span>
                  <span className="text-[0.625rem] text-muted-foreground/30">
                    {relativeTime(event.occurred_at)}
                  </span>
                </div>
                <p className="text-[0.8125rem] leading-relaxed break-words">{summarizeEvent(event)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
