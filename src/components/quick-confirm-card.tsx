'use client'

import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface QuickConfirmCardProps {
  event: {
    prompt: string
    confirm_label: string
    deny_label: string
  }
  onSendMessage: (text: string) => void
}

export function QuickConfirmCard({ event, onSendMessage }: QuickConfirmCardProps) {
  const [choice, setChoice] = useState<'confirm' | 'deny' | null>(null)

  function handleChoice(type: 'confirm' | 'deny') {
    if (choice) return
    setChoice(type)
    onSendMessage(type === 'confirm' ? event.confirm_label : event.deny_label)
  }

  return (
    <div className="border border-border px-4 py-3">
      <p className="text-[0.8125rem] text-foreground/90 mb-3">{event.prompt}</p>

      <div className="flex items-center gap-2">
        <button
          onClick={() => handleChoice('confirm')}
          disabled={choice !== null}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 text-[0.75rem] border transition-all',
            choice === 'confirm'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
              : choice === 'deny'
                ? 'border-border/50 text-muted-foreground/30 cursor-default'
                : 'border-foreground/20 text-foreground hover:bg-foreground/5'
          )}
        >
          {choice === 'confirm' && <Check className="size-3" />}
          {event.confirm_label}
        </button>
        <button
          onClick={() => handleChoice('deny')}
          disabled={choice !== null}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 text-[0.75rem] border transition-all',
            choice === 'deny'
              ? 'border-red-500/30 bg-red-500/10 text-red-500'
              : choice === 'confirm'
                ? 'border-border/50 text-muted-foreground/30 cursor-default'
                : 'border-border text-muted-foreground/70 hover:text-foreground hover:border-foreground/20'
          )}
        >
          {choice === 'deny' && <X className="size-3" />}
          {event.deny_label}
        </button>
      </div>
    </div>
  )
}
