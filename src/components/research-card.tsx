'use client'

import { useState, useEffect } from 'react'
import { Check, FileText } from 'lucide-react'

interface ResearchCardProps {
  topic: string
  startedAt: number
  done?: boolean
  onOpenReport?: () => void
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function ResearchCard({ topic, startedAt, done = false, onOpenReport }: ResearchCardProps) {
  const [elapsed, setElapsed] = useState(Date.now() - startedAt)

  useEffect(() => {
    if (done) return
    const interval = setInterval(() => {
      setElapsed(Date.now() - startedAt)
    }, 1000)
    return () => clearInterval(interval)
  }, [startedAt, done])

  return (
    <div
      className="relative my-4 overflow-hidden rounded-lg border border-muted-foreground/[0.06] animate-in-up"
      style={{
        background: 'hsl(30 6% 13%)',
        transition: 'border-color 0.6s ease, background 0.6s ease',
        ...(done ? { borderColor: 'hsl(30 8% 68% / 0.12)' } : {}),
      }}
    >
      {/* Ambient glow — visible only while active */}
      {!done && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse 60% 50% at 24px 50%, hsl(30 20% 50% / 0.06) 0%, transparent 70%)',
            animation: 'research-ambient 4s ease-in-out infinite',
          }}
        />
      )}

      <div className="relative flex items-center gap-3 px-4 py-3.5">
        {/* Orb */}
        <div className="relative flex-shrink-0">
          <div
            className="size-[28px] rounded-full flex items-center justify-center"
            style={{
              background: done
                ? 'hsl(30 8% 22%)'
                : 'hsl(30 15% 18%)',
              transition: 'background 0.6s ease',
            }}
          >
            {done ? (
              <Check className="size-3.5 text-muted-foreground/80" strokeWidth={2} />
            ) : (
              <div
                className="size-2 rounded-full"
                style={{
                  background: 'hsl(30 30% 60%)',
                  boxShadow: '0 0 8px 2px hsl(30 30% 50% / 0.3)',
                  animation: 'research-orb 3s ease-in-out infinite',
                }}
              />
            )}
          </div>
          {/* Outer ring pulse — active only */}
          {!done && (
            <div
              className="absolute inset-0 rounded-full"
              style={{
                border: '1px solid hsl(30 20% 50% / 0.12)',
                animation: 'research-ring 3s ease-in-out infinite',
              }}
            />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span
              className="text-[0.75rem] font-medium uppercase tracking-[0.12em]"
              style={{
                color: done
                  ? 'hsl(30 8% 68% / 0.5)'
                  : 'hsl(30 8% 68% / 0.7)',
                transition: 'color 0.6s ease',
              }}
            >
              {done ? 'Research complete' : 'Researching'}
            </span>
            {!done && (
              <span
                className="text-[0.6875rem] tabular-nums"
                style={{
                  color: 'hsl(30 8% 68% / 0.3)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatElapsed(elapsed)}
              </span>
            )}
          </div>
          <p
            className="text-[0.8125rem] font-light mt-0.5 truncate"
            style={{
              color: done
                ? 'hsl(30 8% 68% / 0.4)'
                : 'hsl(30 8% 68% / 0.6)',
              transition: 'color 0.6s ease',
            }}
          >
            {topic}
          </p>
        </div>

        {/* Open report button — done state only */}
        {done && onOpenReport && (
          <button
            onClick={onOpenReport}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded text-[0.75rem] font-light transition-colors"
            style={{
              color: 'hsl(30 8% 68% / 0.6)',
              background: 'hsl(30 5% 18%)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = 'hsl(30 8% 68% / 0.9)'
              e.currentTarget.style.background = 'hsl(30 5% 22%)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = 'hsl(30 8% 68% / 0.6)'
              e.currentTarget.style.background = 'hsl(30 5% 18%)'
            }}
          >
            <FileText className="size-3" />
            Open report
          </button>
        )}
      </div>

      {/* Bottom shimmer line — active only */}
      {!done && (
        <div
          className="h-px w-full"
          style={{
            background: 'linear-gradient(90deg, transparent 0%, hsl(30 20% 50% / 0.15) 30%, hsl(30 20% 50% / 0.08) 70%, transparent 100%)',
            backgroundSize: '200% 100%',
            animation: 'research-shimmer-line 3s ease-in-out infinite',
          }}
        />
      )}
    </div>
  )
}
