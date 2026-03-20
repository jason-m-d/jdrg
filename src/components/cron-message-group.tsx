'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

const MESSAGE_TYPE_CONFIG: Record<string, { label: string; emoji: string; borderColor: string; badgeColor: string; bgColor: string }> = {
  alert:          { label: 'Alert',         emoji: '⚡', borderColor: 'border-red-500/30',    badgeColor: 'text-red-500/60',    bgColor: 'bg-red-500/[0.03]' },
  email_heads_up: { label: 'Heads Up',      emoji: '📧', borderColor: 'border-blue-500/30',   badgeColor: 'text-blue-500/60',   bgColor: 'bg-blue-500/[0.03]' },
  watch_match:    { label: 'Watch Match',   emoji: '👀', borderColor: 'border-blue-500/30',   badgeColor: 'text-blue-500/60',   bgColor: 'bg-blue-500/[0.03]' },
  nudge:          { label: 'Nudge',         emoji: '📌', borderColor: 'border-pink-400/30',   badgeColor: 'text-pink-400/60',   bgColor: 'bg-pink-400/[0.03]' },
  briefing:       { label: 'Briefing',      emoji: '☀️', borderColor: 'border-amber-500/30',  badgeColor: 'text-amber-500/60',  bgColor: 'bg-amber-500/[0.03]' },
  bridge_status:  { label: 'Bridge Status', emoji: '🔌', borderColor: 'border-gray-400/30',   badgeColor: 'text-gray-400/60',   bgColor: 'bg-gray-400/[0.03]' },
}

// Priority order for sorting grouped messages (most important first)
const TYPE_PRIORITY: Record<string, number> = {
  alert: 0,
  email_heads_up: 1,
  watch_match: 2,
  nudge: 3,
  briefing: 4,
  bridge_status: 5,
}

function getOneLiner(message: any, _messageType: string): string {
  const content = (message.content || '') as string
  // Strip the emoji prefix and type header, get first meaningful line
  const lines = content.split('\n').filter((l: string) => l.trim())
  // Skip the first line if it's just the type header (e.g., "⚡ Alert" or "📌 Nudge")
  const start = lines[0]?.match(/^[⚡📌☀️👀📧🔌]\s*(Alert|Nudge|Briefing|Watch Match|Heads Up|Bridge Status|Morning Briefing)/i) ? 1 : 0
  const firstLine = lines[start] || lines[0] || content.slice(0, 120)
  return firstLine.replace(/^\*\*.*?\*\*\s*[-–—]?\s*/, '').slice(0, 120)
}

interface CronMessageGroupProps {
  messages: any[]
  resolveType: (msg: any) => string | null
  renderExpanded: (msg: any, i: number) => React.ReactNode
}

export function CronMessageGroup({ messages, resolveType, renderExpanded }: CronMessageGroupProps) {
  const [expanded, setExpanded] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  // Sort by priority (most important first)
  const sorted = [...messages].sort((a, b) => {
    const aType = resolveType(a) || 'bridge_status'
    const bType = resolveType(b) || 'bridge_status'
    return (TYPE_PRIORITY[aType] ?? 99) - (TYPE_PRIORITY[bType] ?? 99)
  })

  if (dismissed) {
    return (
      <div className="py-3 text-center">
        <span className="text-[0.75rem] text-muted-foreground/40 italic">
          {messages.length} update{messages.length > 1 ? 's' : ''} - dismissed
        </span>
      </div>
    )
  }

  if (expanded) {
    return (
      <div className="py-3">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[0.625rem] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium">
            {messages.length} updates while you were away
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setExpanded(false)}
              className="text-[0.6875rem] text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors"
            >
              Collapse
            </button>
            <button
              onClick={() => setDismissed(true)}
              className="text-[0.6875rem] text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
        <div className="space-y-0">
          {sorted.map((msg, i) => renderExpanded(msg, i))}
        </div>
      </div>
    )
  }

  // Collapsed view
  return (
    <div className="py-5 animate-in-up">
      <div className="border border-border/40 rounded-lg overflow-hidden">
        {/* Header */}
        <div className="px-4 py-2.5 border-b border-border/30 bg-muted/20">
          <div className="flex items-center justify-between">
            <span className="text-[0.75rem] font-medium text-muted-foreground/70">
              {messages.length} update{messages.length > 1 ? 's' : ''} while you were away
            </span>
            <button
              onClick={() => setDismissed(true)}
              className="text-[0.6875rem] text-muted-foreground/30 hover:text-muted-foreground/50 transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>

        {/* One-line summaries */}
        <div className="divide-y divide-border/20">
          {sorted.map((msg, i) => {
            const type = resolveType(msg) || 'bridge_status'
            const config = MESSAGE_TYPE_CONFIG[type]
            const oneLiner = getOneLiner(msg, type)
            return (
              <button
                key={msg.id || i}
                onClick={() => setExpanded(true)}
                className="w-full text-left px-4 py-2.5 hover:bg-muted/30 transition-colors flex items-start gap-2.5"
              >
                <span className="text-[0.8125rem] shrink-0 mt-px">{config?.emoji || '•'}</span>
                <div className="min-w-0 flex-1">
                  <span className={cn("text-[0.6875rem] uppercase tracking-wider mr-2", config?.badgeColor || 'text-muted-foreground/50')}>
                    {config?.label || 'Update'}
                  </span>
                  <span className="text-[0.8125rem] text-foreground/80 font-light">
                    {oneLiner}
                  </span>
                </div>
              </button>
            )
          })}
        </div>

        {/* Expand all button */}
        <div className="px-4 py-2 border-t border-border/30 bg-muted/10">
          <button
            onClick={() => setExpanded(true)}
            className="text-[0.75rem] text-muted-foreground/50 hover:text-muted-foreground/70 transition-colors w-full text-center"
          >
            Expand all
          </button>
        </div>
      </div>
    </div>
  )
}
