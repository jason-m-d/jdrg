'use client'

import { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { cn } from '@/lib/utils'
import { DigestBanner } from '@/components/digest-banner'
import { Loader2, X } from 'lucide-react'
import { ChatMessages } from '@/components/chat-messages'
import { ChatInput } from '@/components/chat-input'
import { ArtifactPanel } from '@/components/artifact-panel'
import type { Artifact, DashboardCard } from '@/lib/types'
import { FormattedContent } from '@/components/chat-messages'

interface SurfacedItem {
  id: string
  title: string
  priority: 'high' | 'medium' | 'low'
  context: string
}

const PAGE_SIZE = 50

export default function HomePage() {
  const [messages, setMessages] = useState<any[]>([])
  const [conversationId, setConversationId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('crosby-main-conv-id') || null
    }
    return null
  })
  const [loading, setLoading] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [openArtifactIds, setOpenArtifactIds] = useState<string[]>([])
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null)
  const [showArtifactPanel, setShowArtifactPanel] = useState(false)
  const [dashboardCards, setDashboardCards] = useState<DashboardCard[]>([])
  const [greetingData, setGreetingData] = useState<{ text: string | null; items: SurfacedItem[] } | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const prevScrollHeightRef = useRef<number>(0)
  const shouldRestoreScroll = useRef(false)
  const greetingFetched = useRef(false)

  // Persist conversation ID to localStorage so it survives hot reloads
  useEffect(() => {
    if (conversationId) {
      localStorage.setItem('crosby-main-conv-id', conversationId)
    }
  }, [conversationId])

  useEffect(() => {
    loadMainConversation()
  }, [])

  useLayoutEffect(() => {
    if (shouldRestoreScroll.current && scrollContainerRef.current) {
      const newScrollHeight = scrollContainerRef.current.scrollHeight
      scrollContainerRef.current.scrollTop = newScrollHeight - prevScrollHeightRef.current
      shouldRestoreScroll.current = false
    }
  }, [messages])

  async function loadMainConversation() {
    const supabase = getSupabaseBrowser()

    // Use cached conversation ID if available, otherwise query for most recent
    const cachedConvId = localStorage.getItem('crosby-main-conv-id')

    const [convResult, { data: cards }] = await Promise.all([
      cachedConvId
        ? supabase.from('conversations').select('id').eq('id', cachedConvId).is('project_id', null).single()
            .then(res => res.data ? res : supabase.from('conversations').select('id').is('project_id', null).order('updated_at', { ascending: false }).limit(1).single())
        : supabase.from('conversations').select('id').is('project_id', null).order('updated_at', { ascending: false }).limit(1).single(),
      supabase
        .from('dashboard_cards')
        .select('*')
        .eq('is_active', true)
        .order('position'),
    ])

    const conv = convResult.data
    setDashboardCards(cards || [])

    if (conv) {
      setConversationId(conv.id)

      const [{ data: msgs }, { data: arts }] = await Promise.all([
        supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', conv.id)
          .order('created_at', { ascending: false })
          .limit(PAGE_SIZE),
        supabase
          .from('artifacts')
          .select('*')
          .eq('conversation_id', conv.id)
          .order('updated_at', { ascending: false }),
      ])

      setMessages((msgs || []).reverse())
      setHasMore((msgs || []).length === PAGE_SIZE)
      if (arts && arts.length > 0) setArtifacts(arts)
    } else {
      // Cached conversation was deleted — clear it
      localStorage.removeItem('crosby-main-conv-id')
    }

    setInitialLoading(false)

    // Show greeting card instantly from client-side data, then fill in AI text
    if (!greetingFetched.current) {
      greetingFetched.current = true

      // Instant: query action items directly from Supabase (no API round trip)
      const { data: items } = await supabase
        .from('action_items')
        .select('id, title, priority, due_date, status')
        .in('status', ['pending', 'approved'])
        .or('snoozed_until.is.null,snoozed_until.lte.' + new Date().toISOString())
        .order('priority')
        .order('created_at', { ascending: false })
        .limit(20)

      if (items && items.length > 0) {
        const now = new Date()
        const todayStr = now.toISOString().split('T')[0]
        const surfaced: SurfacedItem[] = items.map(i => ({
          id: i.id,
          title: i.title,
          priority: i.priority,
          context: i.due_date && i.due_date < todayStr ? 'overdue'
            : i.due_date && i.due_date === todayStr ? 'due_today'
            : 'active',
        }))
        // Show card immediately with items
        setGreetingData({ text: null, items: surfaced })
      }

      // Then fetch greeting text (handles debounce, caching, AI generation)
      fetch('/api/session-greeting?items_only=1')
        .then(r => r.json())
        .then(data => {
          if (data.skip) {
            // Debounced and user has chatted - hide the card
            setGreetingData(null)
            return
          }
          if (data.cached) {
            setGreetingData({
              text: data.greeting_text,
              items: data.surfaced_items || [],
            })
            return
          }
          // Generate AI text
          fetch('/api/session-greeting')
            .then(r => r.json())
            .then(full => {
              if (!full.skip && full.greeting_text) {
                setGreetingData(prev => ({
                  text: full.greeting_text,
                  items: prev?.items || full.surfaced_items || [],
                }))
              }
            })
            .catch(() => {})
        })
        .catch(() => {})
    }
  }

  const loadOlderMessages = useCallback(async () => {
    if (!conversationId || loadingMore || !hasMore || messages.length === 0) return
    setLoadingMore(true)

    const container = scrollContainerRef.current
    if (container) {
      prevScrollHeightRef.current = container.scrollHeight
    }

    const supabase = getSupabaseBrowser()
    const oldestMessage = messages[0]

    const { data: olderMsgs } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .lt('created_at', oldestMessage.created_at)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)

    if (olderMsgs && olderMsgs.length > 0) {
      shouldRestoreScroll.current = true
      setMessages(prev => [...olderMsgs.reverse(), ...prev])
      setHasMore(olderMsgs.length === PAGE_SIZE)
    } else {
      setHasMore(false)
    }

    setLoadingMore(false)
  }, [conversationId, loadingMore, hasMore, messages])

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    if (e.currentTarget.scrollTop < 100 && hasMore && !loadingMore) {
      loadOlderMessages()
    }
  }

  async function handleSubmit(userMessage: string) {
    if (!userMessage.trim() || loading) return

    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setLoading(true)
    setStreamingContent('')
    setToolStatus(null)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          conversation_id: conversationId,
          project_id: null,
          active_artifact_id: activeArtifactId,
        }),
      })

      if (!res.ok) {
        throw new Error(`Chat request failed: ${res.status}`)
      }

      const reader = res.body?.getReader()
      if (!reader) {
        throw new Error('No response stream')
      }
      const decoder = new TextDecoder()
      let fullText = ''
      let sources: any[] = []
      const actionItemEvents: any[] = []
      const addToProjectEvents: any[] = []
      const artifactEvents: any[] = []
      const gmailSearchEvents: any[] = []
      const emailDraftEvents: any[] = []
      const projectEvents: any[] = []
      const bookmarkEvents: any[] = []
      const dashboardCardEvents: any[] = []
      const notificationRuleEvents: any[] = []
      const preferenceEvents: any[] = []
      let buffer = ''

      while (reader) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        // Keep the last partial line in the buffer
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.tool_status) {
                setToolStatus(data.tool_status)
              }
              if (data.text) {
                setToolStatus(null)
                fullText += data.text
                setStreamingContent(fullText)
              }
              if (data.action_item) {
                actionItemEvents.push(data.action_item)
                // Remove from greeting surfaced items if completed/dismissed/snoozed
                const itemId = data.action_item.result?.item?.id
                if (itemId && ['completed', 'dismissed', 'snoozed'].includes(data.action_item.result?.status)) {
                  setGreetingData(prev => {
                    if (!prev) return prev
                    const filtered = prev.items.filter(i => i.id !== itemId)
                    return { ...prev, items: filtered }
                  })
                }
              }
              if (data.project_context) {
                addToProjectEvents.push(data.project_context)
              }
              if (data.gmail_search) {
                gmailSearchEvents.push(data.gmail_search)
              }
              if (data.artifact) {
                artifactEvents.push(data.artifact)
                const art = data.artifact.artifact as Artifact
                setArtifacts(prev => {
                  const exists = prev.find(a => a.id === art.id)
                  if (exists) return prev.map(a => a.id === art.id ? art : a)
                  return [art, ...prev]
                })
                setOpenArtifactIds(prev => prev.includes(art.id) ? prev : [...prev, art.id])
                setActiveArtifactId(art.id)
                setShowArtifactPanel(true)
              }
              if (data.email_draft) {
                emailDraftEvents.push(data.email_draft)
              }
              if (data.project) {
                projectEvents.push(data.project)
                window.dispatchEvent(new CustomEvent('projects-changed'))
              }
              if (data.bookmark) {
                bookmarkEvents.push(data.bookmark)
              }
              if (data.dashboard_card) {
                dashboardCardEvents.push(data.dashboard_card)
                // Refresh dashboard cards
                if (data.dashboard_card.status === 'created' && data.dashboard_card.card) {
                  setDashboardCards(prev => [...prev, data.dashboard_card.card])
                } else if (data.dashboard_card.status === 'removed' && data.dashboard_card.card) {
                  setDashboardCards(prev => prev.filter(c => c.id !== data.dashboard_card.card.id))
                } else if (data.dashboard_card.status === 'updated' && data.dashboard_card.card) {
                  setDashboardCards(prev => prev.map(c => c.id === data.dashboard_card.card.id ? data.dashboard_card.card : c))
                }
              }
              if (data.notification_rule) {
                notificationRuleEvents.push(data.notification_rule)
              }
              if (data.preference) {
                preferenceEvents.push(data.preference)
                // Apply accent_color in real-time
                if (data.preference.key === 'accent_color' && data.preference.value) {
                  document.documentElement.style.setProperty('--ring', data.preference.value)
                }
              }
              if (data.done) {
                if (data.conversation_id && !conversationId) {
                  setConversationId(data.conversation_id)
                }
                if (data.sources) sources = data.sources
              }
              if (data.error) {
                fullText = 'Error: ' + data.error
              }
            } catch (e) {
              console.error('SSE parse error:', e, 'line:', line)
            }
          }
        }
      }

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: fullText,
        sources,
        actionItemEvents: actionItemEvents.length > 0 ? actionItemEvents : undefined,
        addToProjectEvents: addToProjectEvents.length > 0 ? addToProjectEvents : undefined,
        artifactEvents: artifactEvents.length > 0 ? artifactEvents : undefined,
        gmailSearchEvents: gmailSearchEvents.length > 0 ? gmailSearchEvents : undefined,
        emailDraftEvents: emailDraftEvents.length > 0 ? emailDraftEvents : undefined,
        projectEvents: projectEvents.length > 0 ? projectEvents : undefined,
        bookmarkEvents: bookmarkEvents.length > 0 ? bookmarkEvents : undefined,
        dashboardCardEvents: dashboardCardEvents.length > 0 ? dashboardCardEvents : undefined,
        notificationRuleEvents: notificationRuleEvents.length > 0 ? notificationRuleEvents : undefined,
        preferenceEvents: preferenceEvents.length > 0 ? preferenceEvents : undefined,
      }])
      setStreamingContent('')
    } catch (err) {
      console.error(err)
      setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.' }])
    } finally {
      setLoading(false)
    }
  }

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="size-4 animate-spin text-muted-foreground/40" />
      </div>
    )
  }

  function handleArtifactClick(artifactId: string) {
    if (!openArtifactIds.includes(artifactId)) {
      setOpenArtifactIds(prev => [...prev, artifactId])
    }
    setActiveArtifactId(artifactId)
    setShowArtifactPanel(true)
  }

  function handleCloseArtifact(artifactId: string) {
    setOpenArtifactIds(prev => prev.filter(id => id !== artifactId))
    if (activeArtifactId === artifactId) {
      const remaining = openArtifactIds.filter(id => id !== artifactId)
      setActiveArtifactId(remaining.length > 0 ? remaining[0] : null)
      if (remaining.length === 0) setShowArtifactPanel(false)
    }
  }

  function handleArtifactUpdated(updated: Artifact) {
    setArtifacts(prev => prev.map(a => a.id === updated.id ? updated : a))
  }

  const openArtifacts = artifacts.filter(a => openArtifactIds.includes(a.id))

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col min-w-0">
        <DigestBanner />

        {/* Dashboard Cards */}
        {dashboardCards.length > 0 && (
          <div className="px-4 pt-4">
            <div className="max-w-3xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-3">
              {dashboardCards.map(card => (
                <div
                  key={card.id}
                  className={cn(
                    "border px-4 py-3 text-[0.8125rem]",
                    card.card_type === 'alert' ? 'border-red-500/30' : 'border-border'
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground/60">
                      {card.title}
                    </span>
                    <span className="text-[0.5625rem] uppercase tracking-wider text-muted-foreground/30">
                      {card.card_type}
                    </span>
                  </div>
                  <div className="text-foreground/80 font-light leading-relaxed">
                    <FormattedContent content={card.content} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-auto flex flex-col"
        >
          {loadingMore && (
            <div className="flex justify-center py-4">
              <Loader2 className="size-3 animate-spin text-muted-foreground/40" />
            </div>
          )}

          <ChatMessages
            messages={messages}
            streamingContent={streamingContent}
            loading={loading}
            toolStatus={toolStatus}
            onArtifactClick={handleArtifactClick}
            greetingData={greetingData}
            onGreetingItemHandled={(itemId) => {
              setGreetingData(prev => {
                if (!prev) return prev
                return { ...prev, items: prev.items.filter(i => i.id !== itemId) }
              })
            }}
          />
        </div>

        <ChatInput onSubmit={handleSubmit} loading={loading} storageKey="main" />
      </div>

      {showArtifactPanel && openArtifacts.length > 0 && (
        <ArtifactPanel
          artifacts={openArtifacts}
          activeArtifactId={activeArtifactId}
          onSelectArtifact={setActiveArtifactId}
          onCloseArtifact={handleCloseArtifact}
          onClosePanel={() => setShowArtifactPanel(false)}
          onArtifactUpdated={handleArtifactUpdated}
        />
      )}
    </div>
  )
}
