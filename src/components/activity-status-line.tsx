'use client'

import { useState, useEffect, useCallback } from 'react'

interface ActivityEvent {
  summary: string
  job_name: string
  created_at: string
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export function ActivityStatusLine() {
  const [event, setEvent] = useState<ActivityEvent | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/activity/recent')
      if (!res.ok) return
      const data = await res.json()
      if (data.event) setEvent(data.event)
    } catch {
      // silent
    }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  if (!event) return null

  return (
    <div className="pt-1.5 pb-0.5">
      <span className="text-[0.68rem] font-mono text-muted-foreground/30">
        {event.summary} · {relativeTime(event.created_at)}
      </span>
    </div>
  )
}
