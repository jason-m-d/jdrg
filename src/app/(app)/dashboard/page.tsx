'use client'

import { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { DigestBanner } from '@/components/digest-banner'
import { Loader2, ArrowUp } from 'lucide-react'
import { ChatMessages } from '@/components/chat-messages'

const PAGE_SIZE = 50

export default function HomePage() {
  const [messages, setMessages] = useState<any[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [initialLoading, setInitialLoading] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
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

      const { data: msgs } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE)

      setMessages((msgs || []).reverse())
      setHasMore((msgs || []).length === PAGE_SIZE)
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

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setLoading(true)
    setStreamingContent('')

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          conversation_id: conversationId,
          project_id: null,
        }),
      })

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let fullText = ''
      let sources: any[] = []
      const actionItemEvents: any[] = []

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
      }])
      setStreamingContent('')
    } catch (err) {
      console.error(err)
      setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.' }])
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="size-4 animate-spin text-muted-foreground/40" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
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
        />
      </div>

      {/* Input */}
      <div className="border-t border-border">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <div className="relative border border-border input-container">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="Message..."
              rows={1}
              className="w-full resize-none bg-transparent px-3.5 py-3 pr-12 text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground/40"
              style={{ minHeight: '46px', maxHeight: '200px' }}
            />
            <button
              onClick={() => handleSubmit()}
              disabled={loading || !input.trim()}
              className="absolute bottom-2.5 right-2.5 p-1.5 bg-foreground text-background disabled:opacity-20 transition-opacity"
            >
              {loading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ArrowUp className="size-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
