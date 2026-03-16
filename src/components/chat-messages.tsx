'use client'

import { useRef, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Check, ChevronDown, FileText, FolderOpen, Loader2, Plus, RefreshCw } from 'lucide-react'
import Link from 'next/link'

interface ChatMessagesProps {
  messages: any[]
  streamingContent: string
  loading: boolean
}

function formatDate() {
  const now = new Date()
  return now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function formatTime(dateStr?: string) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function ChatMessages({ messages, streamingContent, loading }: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  if (messages.length === 0 && !loading) {
    return (
      <div className="flex-1 flex items-center justify-center animate-in-fade">
        <div className="text-center space-y-3">
          <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground/50">
            {formatDate()}
          </div>
          <h2 className="text-2xl font-light tracking-tight text-foreground/80">
            J.DRG
          </h2>
          <div className="w-8 h-px bg-border mx-auto" />
          <p className="text-[13px] text-muted-foreground/60">What are you working on?</p>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 pt-6 pb-2">
      <div className="max-w-3xl mx-auto">
        {messages.map((msg, i) => (
          <MessageBlock key={msg.id || i} message={msg} isLatest={i === messages.length - 1 && !streamingContent} />
        ))}
        {streamingContent && (
          <MessageBlock message={{ role: 'assistant', content: streamingContent }} isLatest />
        )}
        {loading && !streamingContent && (
          <div className="py-6 animate-in-up">
            <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium mb-1.5">
              J.DRG
            </div>
            <div className="flex items-center gap-2 text-muted-foreground/60">
              <span className="inline-block size-1 bg-muted-foreground/40" style={{ animation: 'pulse-subtle 1.5s ease-in-out infinite' }} />
              <span className="inline-block size-1 bg-muted-foreground/40" style={{ animation: 'pulse-subtle 1.5s ease-in-out infinite 0.2s' }} />
              <span className="inline-block size-1 bg-muted-foreground/40" style={{ animation: 'pulse-subtle 1.5s ease-in-out infinite 0.4s' }} />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

function MessageBlock({ message, isLatest }: { message: any; isLatest?: boolean }) {
  const [showSources, setShowSources] = useState(false)
  const isUser = message.role === 'user'
  const time = formatTime(message.created_at)

  return (
    <div className={cn("py-5", isLatest && "animate-in-up")}>
      {/* Role + timestamp */}
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium">
          {isUser ? 'You' : 'J.DRG'}
        </span>
        {time && (
          <span className="text-[10px] text-muted-foreground/30 tabular-nums">{time}</span>
        )}
      </div>

      {/* Content */}
      <div className={cn(
        "text-[14px] leading-[1.7]",
        isUser ? "text-foreground" : "text-foreground/85"
      )}>
        <FormattedContent content={message.content} />
      </div>

      {/* Action Items */}
      {message.actionItemEvents && message.actionItemEvents.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {message.actionItemEvents.map((evt: any, i: number) => (
            <ActionItemCard key={i} event={evt} />
          ))}
        </div>
      )}

      {/* Add to Project */}
      {message.addToProjectEvents && message.addToProjectEvents.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {message.addToProjectEvents.map((evt: any, i: number) => (
            <AddToProjectCard key={i} event={evt} />
          ))}
        </div>
      )}

      {/* Sources */}
      {message.sources && message.sources.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowSources(!showSources)}
            className="flex items-center gap-1.5 text-[10px] tracking-wide uppercase text-muted-foreground/40 hover:text-muted-foreground transition-colors"
          >
            <FileText className="size-3" />
            {message.sources.length} source{message.sources.length !== 1 ? 's' : ''}
            <ChevronDown className={cn(
              "size-3 transition-transform duration-200",
              showSources && "rotate-180"
            )} />
          </button>
          {showSources && (
            <div className="mt-2 space-y-1.5 animate-in-up">
              {message.sources.map((source: any, i: number) => (
                <div key={i} className="text-[12px] border-l-2 border-border pl-3 py-1.5">
                  <span className="text-muted-foreground/40 tabular-nums text-[10px]">
                    {(source.similarity_score * 100).toFixed(0)}%
                  </span>
                  <p className="mt-0.5 text-foreground/60 leading-relaxed">{source.chunk_content}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FormattedContent({ content }: { content: string }) {
  const lines = content.split('\n')
  const elements: JSX.Element[] = []
  let inCodeBlock = false
  let codeContent = ''
  let codeLang = ''

  lines.forEach((line, i) => {
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <div key={i} className="my-3">
            {codeLang && (
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground/40 mb-1">{codeLang}</div>
            )}
            <pre className="bg-muted/60 p-3 overflow-x-auto text-[12px] leading-relaxed font-[family-name:var(--font-geist-mono)]">
              <code>{codeContent.trim()}</code>
            </pre>
          </div>
        )
        codeContent = ''
        codeLang = ''
        inCodeBlock = false
      } else {
        codeLang = line.slice(3).trim()
        inCodeBlock = true
      }
      return
    }

    if (inCodeBlock) {
      codeContent += line + '\n'
      return
    }

    if (line.startsWith('### ')) {
      elements.push(
        <h3 key={i} className="font-semibold text-[13px] mt-5 mb-1 tracking-tight">
          {formatInline(line.slice(4))}
        </h3>
      )
    } else if (line.startsWith('## ')) {
      elements.push(
        <h2 key={i} className="font-semibold text-[15px] mt-5 mb-1 tracking-tight">
          {formatInline(line.slice(3))}
        </h2>
      )
    } else if (line.startsWith('# ')) {
      elements.push(
        <h1 key={i} className="font-semibold text-[17px] mt-5 mb-1 tracking-tight">
          {formatInline(line.slice(2))}
        </h1>
      )
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(
        <div key={i} className="flex gap-2 pl-1">
          <span className="text-muted-foreground/40 select-none">&ndash;</span>
          <span>{formatInline(line.slice(2))}</span>
        </div>
      )
    } else if (/^\d+\.\s/.test(line)) {
      const match = line.match(/^(\d+)\.\s(.*)/)
      if (match) {
        elements.push(
          <div key={i} className="flex gap-2 pl-1">
            <span className="text-muted-foreground/40 tabular-nums select-none w-4 text-right shrink-0">{match[1]}.</span>
            <span>{formatInline(match[2])}</span>
          </div>
        )
      }
    } else if (line.trim() === '') {
      elements.push(<div key={i} className="h-3" />)
    } else {
      elements.push(<p key={i}>{formatInline(line)}</p>)
    }
  })

  return <>{elements}</>
}

function ActionItemCard({ event }: { event: any }) {
  const { operation, result } = event
  const item = result.item

  if (operation === 'list') return null

  const configs: Record<string, { icon: typeof Plus; label: string; color: string }> = {
    create: { icon: Plus, label: 'Action item added', color: 'text-emerald-500' },
    complete: { icon: Check, label: 'Marked complete', color: 'text-blue-500' },
    update: { icon: RefreshCw, label: 'Updated', color: 'text-amber-500' },
  }
  const config = configs[operation] || { icon: Plus, label: operation, color: 'text-muted-foreground' }

  if (result.status === 'duplicate') {
    return null // Claude handles this conversationally
  }

  const Icon = config.icon

  return (
    <div className="flex items-center gap-2 text-[12px] border border-border px-3 py-2">
      <Icon className={cn("size-3 shrink-0", config.color)} />
      <span className="text-muted-foreground">{config.label}:</span>
      <span className="text-foreground/80 truncate">{item?.title || 'Unknown'}</span>
      {item?.priority === 'high' && (
        <span className="text-[10px] uppercase tracking-wider text-red-500/70 ml-auto shrink-0">high</span>
      )}
    </div>
  )
}

function AddToProjectCard({ event }: { event: any }) {
  if (event.status === 'error') {
    return (
      <div className="flex items-center gap-2 text-[12px] border border-border px-3 py-2">
        <FolderOpen className="size-3 shrink-0 text-red-500" />
        <span className="text-muted-foreground">{event.message}</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 text-[12px] border border-border px-3 py-2">
      <FolderOpen className="size-3 shrink-0 text-blue-500" />
      <span className="text-muted-foreground">Added to</span>
      <Link href={event.conversation_url || '#'} className="text-foreground/80 font-medium hover:underline">
        {event.project_name}
      </Link>
    </div>
  )
}

function formatInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  let remaining = text
  let key = 0

  while (remaining.length > 0) {
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`(.*)$/)
    if (codeMatch) {
      if (codeMatch[1]) parts.push(<span key={key++}>{codeMatch[1]}</span>)
      parts.push(
        <code key={key++} className="bg-muted/80 px-1 py-px text-[12px] font-[family-name:var(--font-geist-mono)]">
          {codeMatch[2]}
        </code>
      )
      remaining = codeMatch[3]
      continue
    }

    const boldMatch = remaining.match(/^(.*?)\*\*([^*]+)\*\*(.*)$/)
    if (boldMatch) {
      if (boldMatch[1]) parts.push(<span key={key++}>{boldMatch[1]}</span>)
      parts.push(<strong key={key++} className="font-semibold">{boldMatch[2]}</strong>)
      remaining = boldMatch[3]
      continue
    }

    const italicMatch = remaining.match(/^(.*?)\*([^*]+)\*(.*)$/)
    if (italicMatch) {
      if (italicMatch[1]) parts.push(<span key={key++}>{italicMatch[1]}</span>)
      parts.push(<em key={key++} className="italic">{italicMatch[2]}</em>)
      remaining = italicMatch[3]
      continue
    }

    parts.push(<span key={key++}>{remaining}</span>)
    break
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>
}
