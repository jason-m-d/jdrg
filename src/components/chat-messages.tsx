'use client'

import { useRef, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Bell, Check, ChevronDown, Clock, Copy, FileText, FolderOpen, FolderPen, FolderPlus, FolderX, GraduationCap, LayoutDashboard, Link2, Loader2, Mail, MailPlus, NotebookPen, Palette, Pencil, PencilLine, Plus, RefreshCw, Send, ThumbsDown, ThumbsUp, Trash2, X } from 'lucide-react'
import Link from 'next/link'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { GreetingCard } from '@/components/greeting-card'

interface SurfacedItem {
  id: string
  title: string
  priority: 'high' | 'medium' | 'low'
  context: string
}

interface GreetingData {
  text: string | null
  items: SurfacedItem[]
}

interface ChatMessagesProps {
  messages: any[]
  streamingContent: string
  loading: boolean
  toolStatus?: string | null
  onArtifactClick?: (artifactId: string) => void
  onCopyMessage?: (content: string) => void
  onEditMessage?: (messageIndex: number, content: string) => void
  greetingData?: GreetingData | null
  onGreetingItemHandled?: (itemId: string) => void
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

export function ChatMessages({ messages, streamingContent, loading, toolStatus, onArtifactClick, onCopyMessage, onEditMessage, greetingData, onGreetingItemHandled }: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent, greetingData])

  if (messages.length === 0 && !loading) {
    return (
      <div className="flex-1 flex items-center justify-center animate-in-fade">
        <div className="text-center space-y-3">
          <div className="text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground/50">
            {formatDate()}
          </div>
          <h2 className="text-2xl font-light tracking-tight text-foreground/80">
            Crosby
          </h2>
          <div className="w-8 h-px bg-border mx-auto" />
          <p className="text-[0.8125rem] text-muted-foreground/60">What are you working on?</p>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 pt-6 pb-2">
      <div className="max-w-3xl mx-auto">
        {greetingData && (
          <GreetingCard
            greeting={greetingData.text}
            items={greetingData.items}
            onItemHandled={onGreetingItemHandled}
          />
        )}
        {messages.map((msg, i) => (
          <MessageBlock
            key={msg.id || i}
            message={msg}
            isLatest={i === messages.length - 1 && !streamingContent}
            onArtifactClick={onArtifactClick}
            onCopy={msg.role === 'user' ? () => onCopyMessage?.(msg.content) : undefined}
            onEdit={msg.role === 'user' ? () => onEditMessage?.(i, msg.content) : undefined}
          />
        ))}
        {streamingContent && (
          <MessageBlock message={{ role: 'assistant', content: streamingContent }} isLatest isStreaming={loading} toolStatus={toolStatus} />
        )}
        {loading && !streamingContent && (
          <div className="py-6 animate-in-up">
            <div className="text-[0.625rem] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium mb-1.5">
              Crosby
            </div>
            <div className="h-[1.2rem] flex items-center">
              {toolStatus ? (
                <span
                  key={toolStatus}
                  className="text-[0.8125rem] font-light tracking-wide"
                  style={{
                    background: 'linear-gradient(90deg, hsl(var(--muted-foreground) / 0.3) 0%, hsl(var(--muted-foreground) / 0.6) 50%, hsl(var(--muted-foreground) / 0.3) 100%)',
                    backgroundSize: '200% 100%',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                    animation: 'text-shimmer 2.5s ease-in-out infinite, fade-in 0.3s ease both',
                  }}
                >
                  {toolStatus}
                </span>
              ) : (
                <div className="flex items-center gap-2 animate-in-fade">
                  <span className="inline-block size-1 bg-muted-foreground/40" style={{ animation: 'pulse-subtle 1.5s ease-in-out infinite' }} />
                  <span className="inline-block size-1 bg-muted-foreground/40" style={{ animation: 'pulse-subtle 1.5s ease-in-out infinite 0.2s' }} />
                  <span className="inline-block size-1 bg-muted-foreground/40" style={{ animation: 'pulse-subtle 1.5s ease-in-out infinite 0.4s' }} />
                </div>
              )}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

function isProactiveMessage(content: string) {
  return content.startsWith('☀️ **Morning Briefing') || content.startsWith('⚡ **Alert')
}

function ProactiveFeedback({ messageContent }: { messageContent: string }) {
  const [showInput, setShowInput] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [sent, setSent] = useState(false)

  async function handleSubmit() {
    if (!feedback.trim()) return
    const prefix = messageContent.startsWith('☀️') ? 'Briefing feedback' : 'Alert feedback'
    await getSupabaseBrowser().from('memories').insert({
      content: `${prefix}: ${feedback.trim()}`,
      category: 'preference',
    })
    setSent(true)
    setShowInput(false)
    setFeedback('')
  }

  if (sent) {
    return <span className="text-[0.6875rem] text-muted-foreground/40">Preference saved</span>
  }

  if (showInput) {
    return (
      <div className="flex items-center gap-2 mt-2">
        <input
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="What should change?"
          className="flex-1 bg-transparent border border-border px-2.5 py-1 text-[0.75rem] outline-none placeholder:text-muted-foreground/30 focus:border-foreground/30 transition-colors"
          autoFocus
        />
        <button onClick={handleSubmit} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
          <Send className="size-3" />
        </button>
        <button onClick={() => setShowInput(false)} className="p-1 text-muted-foreground/40 hover:text-foreground transition-colors">
          <X className="size-3" />
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setShowInput(true)}
      className="text-[0.6875rem] text-muted-foreground/40 hover:text-muted-foreground transition-colors mt-2"
    >
      Adjust this
    </button>
  )
}

function MessageBlock({ message, isLatest, isStreaming, toolStatus, onArtifactClick, onCopy, onEdit }: { message: any; isLatest?: boolean; isStreaming?: boolean; toolStatus?: string | null; onArtifactClick?: (artifactId: string) => void; onCopy?: () => void; onEdit?: () => void }) {
  const [copied, setCopied] = useState(false)
  const [showSources, setShowSources] = useState(false)
  const isUser = message.role === 'user'
  const time = formatTime(message.created_at)
  const isProactive = !isUser && isProactiveMessage(message.content || '')
  const isBriefing = !isUser && (message.content || '').startsWith('☀️ **Morning Briefing')
  const isAlert = !isUser && (message.content || '').startsWith('⚡ **Alert')

  return (
    <div className={cn("py-5 group", isLatest && "animate-in-up", isUser && "flex flex-col items-end")}>
      {/* Role + timestamp */}
      <div className={cn("flex items-baseline gap-2 mb-1.5", isUser && "flex-row-reverse")}>
        <span className="text-[0.625rem] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium">
          {isUser ? 'You' : 'Crosby'}
        </span>
        {isBriefing && (
          <span className="text-[0.625rem] uppercase tracking-wider text-amber-500/60">Briefing</span>
        )}
        {isAlert && (
          <span className="text-[0.625rem] uppercase tracking-wider text-red-500/60">Alert</span>
        )}
        {time && (
          <span className="text-[0.625rem] text-muted-foreground/30 tabular-nums">{time}</span>
        )}
      </div>

      {/* Content */}
      <div className={cn(
        "text-[0.9375rem] leading-[1.7]",
        isUser ? "text-foreground bg-muted/50 px-4 py-2.5 rounded-2xl rounded-tr-sm max-w-[85%]" : "text-foreground/95 tracking-[0.01em] font-light",
        isBriefing && "border-l-2 border-amber-500/30 pl-4",
        isAlert && "border-l-2 border-red-500/30 pl-4",
      )}>
        <FormattedContent content={message.content} />
        {isStreaming && (
          <span className="inline-flex items-center gap-1 ml-1 align-middle">
            {toolStatus ? (
              <span
                key={toolStatus}
                className="text-[0.75rem] font-light tracking-wide"
                style={{
                  background: 'linear-gradient(90deg, hsl(var(--muted-foreground) / 0.3) 0%, hsl(var(--muted-foreground) / 0.6) 50%, hsl(var(--muted-foreground) / 0.3) 100%)',
                  backgroundSize: '200% 100%',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                  animation: 'text-shimmer 2.5s ease-in-out infinite, fade-in 0.3s ease both',
                }}
              >
                {toolStatus}
              </span>
            ) : (
              <>
                <span className="inline-block size-1 rounded-full bg-muted-foreground/40" style={{ animation: 'pulse-subtle 1.5s ease-in-out infinite' }} />
                <span className="inline-block size-1 rounded-full bg-muted-foreground/40" style={{ animation: 'pulse-subtle 1.5s ease-in-out infinite 0.2s' }} />
                <span className="inline-block size-1 rounded-full bg-muted-foreground/40" style={{ animation: 'pulse-subtle 1.5s ease-in-out infinite 0.4s' }} />
              </>
            )}
          </span>
        )}
      </div>

      {/* User message actions */}
      {isUser && (onCopy || onEdit) && (
        <div className="flex items-center gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {onCopy && (
            <button
              onClick={() => {
                onCopy()
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
              className="p-1 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
              title="Copy message"
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            </button>
          )}
          {onEdit && (
            <button
              onClick={onEdit}
              className="p-1 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
              title="Edit & resend"
            >
              <PencilLine className="size-3" />
            </button>
          )}
        </div>
      )}

      {/* Proactive feedback */}
      {isProactive && <ProactiveFeedback messageContent={message.content} />}

      {/* Action Items */}
      {message.actionItemEvents && message.actionItemEvents.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <CollapsibleCards count={message.actionItemEvents.length}>
            {message.actionItemEvents.map((evt: any, i: number) => (
              <ActionItemCard key={i} event={evt} />
            ))}
          </CollapsibleCards>
        </div>
      )}

      {/* Add to Project */}
      {message.addToProjectEvents && message.addToProjectEvents.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <CollapsibleCards count={message.addToProjectEvents.length}>
            {message.addToProjectEvents.map((evt: any, i: number) => (
              <AddToProjectCard key={i} event={evt} />
            ))}
          </CollapsibleCards>
        </div>
      )}

      {/* Gmail Search */}
      {message.gmailSearchEvents && message.gmailSearchEvents.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <CollapsibleCards count={message.gmailSearchEvents.length}>
            {message.gmailSearchEvents.map((evt: any, i: number) => (
              <GmailSearchCard key={i} event={evt} />
            ))}
          </CollapsibleCards>
        </div>
      )}

      {/* Email Drafts */}
      {message.emailDraftEvents && message.emailDraftEvents.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <CollapsibleCards count={message.emailDraftEvents.length}>
            {message.emailDraftEvents.map((evt: any, i: number) => (
              <EmailDraftCard key={i} event={evt} />
            ))}
          </CollapsibleCards>
        </div>
      )}

      {/* Artifacts */}
      {message.artifactEvents && message.artifactEvents.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <CollapsibleCards count={message.artifactEvents.length}>
            {message.artifactEvents.map((evt: any, i: number) => (
              <ArtifactCard key={i} event={evt} onClick={onArtifactClick} />
            ))}
          </CollapsibleCards>
        </div>
      )}

      {/* Projects */}
      {message.projectEvents && message.projectEvents.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <CollapsibleCards count={message.projectEvents.length}>
            {message.projectEvents.map((evt: any, i: number) => (
              <ProjectCard key={i} event={evt} />
            ))}
          </CollapsibleCards>
        </div>
      )}

      {/* Bookmarks */}
      {message.bookmarkEvents && message.bookmarkEvents.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <CollapsibleCards count={message.bookmarkEvents.length}>
            {message.bookmarkEvents.map((evt: any, i: number) => (
              <BookmarkCard key={i} event={evt} />
            ))}
          </CollapsibleCards>
        </div>
      )}

      {/* Dashboard Cards */}
      {message.dashboardCardEvents && message.dashboardCardEvents.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <CollapsibleCards count={message.dashboardCardEvents.length}>
            {message.dashboardCardEvents.map((evt: any, i: number) => (
              <DashboardCardCard key={i} event={evt} />
            ))}
          </CollapsibleCards>
        </div>
      )}

      {/* Notification Rules */}
      {message.notificationRuleEvents && message.notificationRuleEvents.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <CollapsibleCards count={message.notificationRuleEvents.length}>
            {message.notificationRuleEvents.map((evt: any, i: number) => (
              <NotificationRuleCard key={i} event={evt} />
            ))}
          </CollapsibleCards>
        </div>
      )}

      {/* Preferences */}
      {message.preferenceEvents && message.preferenceEvents.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <CollapsibleCards count={message.preferenceEvents.length}>
            {message.preferenceEvents.map((evt: any, i: number) => (
              <PreferenceCard key={i} event={evt} />
            ))}
          </CollapsibleCards>
        </div>
      )}

      {/* Training */}
      {message.trainingEvents && message.trainingEvents.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <CollapsibleCards count={message.trainingEvents.length}>
            {message.trainingEvents.map((evt: any, i: number) => (
              <TrainingCard key={i} event={evt} />
            ))}
          </CollapsibleCards>
        </div>
      )}

      {/* Sources */}
      {message.sources && message.sources.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowSources(!showSources)}
            className="flex items-center gap-1.5 text-[0.625rem] tracking-wide uppercase text-muted-foreground/40 hover:text-muted-foreground transition-colors"
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
                <div key={i} className="text-[0.75rem] border-l-2 border-border pl-3 py-1.5">
                  <span className="text-muted-foreground/40 tabular-nums text-[0.625rem]">
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

export function FormattedContent({ content }: { content: string }) {
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
              <div className="text-[0.625rem] uppercase tracking-wider text-muted-foreground/40 mb-1">{codeLang}</div>
            )}
            <pre className="bg-muted/60 p-3 overflow-x-auto text-[0.75rem] leading-relaxed font-[family-name:var(--font-geist-mono)]">
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
        <h3 key={i} className="font-semibold text-[0.8125rem] mt-5 mb-1 tracking-tight">
          {formatInline(line.slice(4))}
        </h3>
      )
    } else if (line.startsWith('## ')) {
      elements.push(
        <h2 key={i} className="font-semibold text-[0.9375rem] mt-5 mb-1 tracking-tight">
          {formatInline(line.slice(3))}
        </h2>
      )
    } else if (line.startsWith('# ')) {
      elements.push(
        <h1 key={i} className="font-semibold text-[1.0625rem] mt-5 mb-1 tracking-tight">
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
    dismiss: { icon: X, label: 'Dismissed', color: 'text-muted-foreground' },
    snooze: { icon: Clock, label: 'Snoozed', color: 'text-blue-400' },
  }
  const config = configs[operation] || { icon: Plus, label: operation, color: 'text-muted-foreground' }

  if (result.status === 'duplicate') {
    return null // Claude handles this conversationally
  }

  const Icon = config.icon

  return (
    <div className="flex items-center gap-2 text-[0.75rem] border border-border px-3 py-2">
      <Icon className={cn("size-3 shrink-0", config.color)} />
      <span className="text-muted-foreground">{config.label}:</span>
      <span className="text-foreground/80 truncate">{item?.title || 'Unknown'}</span>
      {item?.priority === 'high' && (
        <span className="text-[0.625rem] uppercase tracking-wider text-red-500/70 ml-auto shrink-0">high</span>
      )}
    </div>
  )
}

function CollapsibleCards({ children, count }: { children: React.ReactNode[]; count: number }) {
  const [expanded, setExpanded] = useState(false)
  const MAX = 2
  if (count <= MAX) {
    return <>{children}</>
  }
  return (
    <>
      {children.slice(0, MAX)}
      {expanded && children.slice(MAX)}
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-1 text-[0.7rem] text-muted-foreground/50 hover:text-muted-foreground transition-colors mt-0.5"
      >
        <ChevronDown className={cn("size-3 transition-transform duration-200", expanded && "rotate-180")} />
        {expanded ? 'Show less' : `${count - MAX} more`}
      </button>
    </>
  )
}

function AddToProjectCard({ event }: { event: any }) {
  if (event.status === 'error') {
    return (
      <div className="flex items-center gap-2 text-[0.75rem] border border-border px-3 py-2">
        <FolderOpen className="size-3 shrink-0 text-red-500" />
        <span className="text-muted-foreground">{event.message}</span>
      </div>
    )
  }

  const label = event.status === 'updated' ? 'Updated context on' : event.status === 'archived' ? 'Archived context from' : 'Added context to'
  const isClickable = event.project_id && event.context_id && event.status !== 'archived'

  const content = (
    <>
      <FolderOpen className="size-3 shrink-0 text-blue-500" />
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground/80 font-medium">
        {event.project_name}
      </span>
    </>
  )

  if (isClickable) {
    return (
      <Link
        href={`/projects/${event.project_id}?continue=${event.context_id}`}
        className="flex items-center gap-2 text-[0.75rem] border border-border px-3 py-2 hover:bg-muted/30 transition-colors"
      >
        {content}
      </Link>
    )
  }

  return (
    <div className="flex items-center gap-2 text-[0.75rem] border border-border px-3 py-2">
      {content}
    </div>
  )
}

function GmailSearchCard({ event }: { event: any }) {
  const hasError = !!event.error
  return (
    <div className={cn("flex items-center gap-2 text-[0.75rem] border px-3 py-2", hasError ? "border-red-500/40" : "border-border")}>
      <Mail className={cn("size-3 shrink-0", hasError ? "text-red-500" : "text-red-400")} />
      <span className="text-muted-foreground">Searched Gmail:</span>
      <span className="text-foreground/80 truncate">{event.query}</span>
      <span className={cn("text-[0.625rem] ml-auto shrink-0", hasError ? "text-red-500/70" : "text-muted-foreground/50")}>
        {hasError ? 'error' : `${event.result_count} result${event.result_count !== 1 ? 's' : ''}`}
      </span>
    </div>
  )
}

function ArtifactCard({ event, onClick }: { event: any; onClick?: (artifactId: string) => void }) {
  const isCreate = event.operation === 'create'
  const artifact = event.artifact

  return (
    <button
      onClick={() => onClick?.(artifact?.id)}
      className="flex items-center gap-2 text-[0.75rem] border border-border px-3 py-2 hover:bg-muted/30 transition-colors w-full text-left"
    >
      {isCreate ? (
        <NotebookPen className="size-3 shrink-0 text-violet-500" />
      ) : (
        <Pencil className="size-3 shrink-0 text-amber-500" />
      )}
      <span className="text-muted-foreground">{isCreate ? 'Created' : 'Updated'}:</span>
      <span className="text-foreground/80 truncate">{artifact?.name || 'Untitled'}</span>
      {artifact?.type && artifact.type !== 'freeform' && (
        <span className="text-[0.625rem] uppercase tracking-wider text-muted-foreground/50 ml-auto shrink-0">{artifact.type}</span>
      )}
    </button>
  )
}

function EmailDraftCard({ event }: { event: any }) {
  const isError = event.status === 'error'
  return (
    <div className="flex items-center gap-2 text-[0.75rem] border border-border px-3 py-2">
      <MailPlus className={cn("size-3 shrink-0", isError ? 'text-red-500' : 'text-emerald-500')} />
      <span className="text-muted-foreground">{isError ? 'Draft failed' : 'Draft created'}:</span>
      <span className="text-foreground/80 truncate">{event.subject || event.message}</span>
      {!isError && event.to && (
        <span className="text-[0.625rem] text-muted-foreground/50 ml-auto shrink-0">to {event.to}</span>
      )}
    </div>
  )
}

function ProjectCard({ event }: { event: any }) {
  const configs: Record<string, { icon: typeof FolderPlus; label: string; color: string }> = {
    created: { icon: FolderPlus, label: 'Project created', color: 'text-emerald-500' },
    updated: { icon: FolderPen, label: 'Project updated', color: 'text-amber-500' },
    archived: { icon: FolderX, label: 'Project archived', color: 'text-red-500' },
  }
  const config = configs[event.status] || { icon: FolderPlus, label: event.operation, color: 'text-muted-foreground' }
  const Icon = config.icon

  return (
    <div className="flex items-center gap-2 text-[0.75rem] border border-border px-3 py-2">
      <Icon className={cn("size-3 shrink-0", config.color)} />
      <span className="text-muted-foreground">{config.label}:</span>
      <span className="text-foreground/80 truncate">{event.project?.name || 'Unknown'}</span>
    </div>
  )
}

function BookmarkCard({ event }: { event: any }) {
  const isDelete = event.operation === 'delete'
  return (
    <div className="flex items-center gap-2 text-[0.75rem] border border-border px-3 py-2">
      {isDelete ? (
        <Trash2 className="size-3 shrink-0 text-red-500" />
      ) : (
        <Link2 className="size-3 shrink-0 text-blue-500" />
      )}
      <span className="text-muted-foreground">{isDelete ? 'Bookmark removed' : 'Bookmark added'}:</span>
      <span className="text-foreground/80 truncate">{event.bookmark?.title || event.bookmark?.url || 'Unknown'}</span>
    </div>
  )
}

function DashboardCardCard({ event }: { event: any }) {
  const configs: Record<string, { label: string; color: string }> = {
    created: { label: 'Card pinned to dashboard', color: 'text-emerald-500' },
    updated: { label: 'Dashboard card updated', color: 'text-amber-500' },
    removed: { label: 'Dashboard card removed', color: 'text-red-500' },
  }
  const config = configs[event.status] || { label: event.operation, color: 'text-muted-foreground' }

  return (
    <div className="flex items-center gap-2 text-[0.75rem] border border-border px-3 py-2">
      <LayoutDashboard className={cn("size-3 shrink-0", config.color)} />
      <span className="text-muted-foreground">{config.label}:</span>
      <span className="text-foreground/80 truncate">{event.card?.title || 'Unknown'}</span>
    </div>
  )
}

function NotificationRuleCard({ event }: { event: any }) {
  const configs: Record<string, { label: string; color: string }> = {
    created: { label: 'Alert rule created', color: 'text-emerald-500' },
    deleted: { label: 'Alert rule removed', color: 'text-red-500' },
    enabled: { label: 'Alert rule enabled', color: 'text-emerald-500' },
    disabled: { label: 'Alert rule paused', color: 'text-amber-500' },
  }
  const config = configs[event.status] || { label: event.operation, color: 'text-muted-foreground' }

  return (
    <div className="flex items-center gap-2 text-[0.75rem] border border-border px-3 py-2">
      <Bell className={cn("size-3 shrink-0", config.color)} />
      <span className="text-muted-foreground">{config.label}:</span>
      <span className="text-foreground/80 truncate">{event.rule?.description || 'Unknown'}</span>
    </div>
  )
}

function PreferenceCard({ event }: { event: any }) {
  return (
    <div className="flex items-center gap-2 text-[0.75rem] border border-border px-3 py-2">
      <Palette className="size-3 shrink-0 text-violet-500" />
      <span className="text-muted-foreground">Preference set:</span>
      <span className="text-foreground/80">{event.key} = {event.value}</span>
    </div>
  )
}

function TrainingCard({ event }: { event: any }) {
  const { operation, result } = event

  if (operation === 'stats') {
    return (
      <div className="flex items-center gap-2 text-[0.75rem] border border-border px-3 py-2">
        <GraduationCap className="size-3 shrink-0 text-violet-500" />
        <span className="text-muted-foreground">Training progress:</span>
        <span className="text-foreground/80">{result.total_examples} examples, {result.rules_count} rules active</span>
      </div>
    )
  }

  if (operation === 'label') {
    return (
      <div className="flex items-center gap-2 text-[0.75rem] border border-border px-3 py-2">
        <GraduationCap className="size-3 shrink-0 text-emerald-500" />
        <span className="text-muted-foreground">Preference learned:</span>
        <span className="text-foreground/80">{result.is_action_item ? 'Track items like this' : 'Skip items like this'}</span>
      </div>
    )
  }

  if (operation === 'teach_me') {
    return <TeachMeQuiz snippets={result.snippets || []} message={result.message} />
  }

  return null
}

function TeachMeQuiz({ snippets, message }: { snippets: any[]; message?: string }) {
  const [index, setIndex] = useState(0)
  const [labeling, setLabeling] = useState(false)
  const [labeled, setLabeled] = useState(0)

  if (snippets.length === 0) {
    return (
      <div className="flex items-center gap-2 text-[0.75rem] border border-border px-3 py-2">
        <GraduationCap className="size-3 shrink-0 text-muted-foreground" />
        <span className="text-muted-foreground">{message || 'No snippets available for training right now.'}</span>
      </div>
    )
  }

  const done = index >= snippets.length
  const current = snippets[index]

  async function answer(isActionItem: boolean) {
    if (!current || labeling) return
    setLabeling(true)
    try {
      await fetch('/api/training/label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snippet: current.text,
          is_action_item: isActionItem,
          label_source: 'teach_me',
          source_type: current.source_type,
          metadata: current.metadata,
        }),
      })
    } catch { /* continue anyway */ }
    setLabeling(false)
    setLabeled(prev => prev + 1)
    setIndex(prev => prev + 1)
  }

  if (done) {
    return (
      <div className="border border-border px-4 py-3">
        <div className="flex items-center gap-2 text-[0.75rem]">
          <GraduationCap className="size-3 shrink-0 text-emerald-500" />
          <span className="text-foreground font-medium">Done! {labeled} examples labeled.</span>
        </div>
        <p className="text-[0.6875rem] text-muted-foreground/60 mt-1">This helps me learn what you consider an action item.</p>
      </div>
    )
  }

  return (
    <div className="border border-border px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[0.625rem] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium flex items-center gap-1.5">
          <GraduationCap className="size-3" />
          Is this an action item? ({index + 1}/{snippets.length})
        </span>
      </div>
      <div className="bg-muted/40 border border-border/50 p-3 mb-3 text-[0.75rem] text-muted-foreground leading-relaxed max-h-[200px] overflow-auto whitespace-pre-wrap">
        {current?.text}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => answer(true)}
          disabled={labeling}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[0.75rem] border border-green-600/30 text-green-600 hover:bg-green-600/10 transition-colors disabled:opacity-30"
        >
          {labeling ? <Loader2 className="size-3 animate-spin" /> : <ThumbsUp className="size-3" />}
          Yes, action item
        </button>
        <button
          onClick={() => answer(false)}
          disabled={labeling}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[0.75rem] border border-red-600/30 text-red-600 hover:bg-red-600/10 transition-colors disabled:opacity-30"
        >
          {labeling ? <Loader2 className="size-3 animate-spin" /> : <ThumbsDown className="size-3" />}
          No
        </button>
      </div>
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
        <code key={key++} className="bg-muted/80 px-1 py-px text-[0.75rem] font-[family-name:var(--font-geist-mono)]">
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
