'use client'

import { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { DigestBanner } from '@/components/digest-banner'
import { Loader2 } from 'lucide-react'
import { ChatMessages } from '@/components/chat-messages'
import { ChatInput } from '@/components/chat-input'
import { ArtifactPanel } from '@/components/artifact-panel'
import type { Artifact } from '@/lib/types'

const PAGE_SIZE = 50

export default function HomePage() {
  const [messages, setMessages] = useState<any[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [initialLoading, setInitialLoading] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [openArtifactIds, setOpenArtifactIds] = useState<string[]>([])
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null)
  const [showArtifactPanel, setShowArtifactPanel] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const prevScrollHeightRef = useRef<number>(0)
  const shouldRestoreScroll = useRef(false)

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

    const { data: conv } = await supabase
      .from('conversations')
      .select('id')
      .is('project_id', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single()

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
    }

    setInitialLoading(false)
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

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let fullText = ''
      let sources: any[] = []
      const actionItemEvents: any[] = []
      const addToProjectEvents: any[] = []
      const artifactEvents: any[] = []
      const gmailSearchEvents: any[] = []

      while (reader) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.text) {
                fullText += data.text
                setStreamingContent(fullText)
              }
              if (data.action_item) {
                actionItemEvents.push(data.action_item)
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
              if (data.done) {
                if (data.conversation_id && !conversationId) {
                  setConversationId(data.conversation_id)
                }
                if (data.sources) sources = data.sources
              }
              if (data.error) {
                fullText = 'Error: ' + data.error
              }
            } catch {}
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
            onArtifactClick={handleArtifactClick}
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
