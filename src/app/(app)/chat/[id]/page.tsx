'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Loader2, ArrowUp } from 'lucide-react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { ChatMessages } from '@/components/chat-messages'

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>()
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [projectId, setProjectId] = useState<string>('none')
  const [projects, setProjects] = useState<any[]>([])
  const [streamingContent, setStreamingContent] = useState('')
  const [initialLoading, setInitialLoading] = useState(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const supabase = getSupabaseBrowser()

    supabase.from('projects').select('id, name, color').order('name')
      .then(({ data }) => setProjects(data || []))

    supabase.from('conversations').select('project_id').eq('id', id).single()
      .then(({ data }) => {
        setProjectId(data?.project_id || 'none')
      })

    supabase.from('messages').select('*').eq('conversation_id', id).order('created_at')
      .then(({ data }) => {
        setMessages(data || [])
        setInitialLoading(false)
      })
  }, [id])

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
          conversation_id: id,
          project_id: projectId === 'none' ? null : projectId,
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
      {/* Header */}
      <div className="flex items-center gap-4 border-b border-border px-6 py-3">
        <span className="text-[13px] font-medium uppercase tracking-[0.1em]">Chat</span>
        <div className="w-px h-4 bg-border" />
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="bg-transparent text-[12px] text-muted-foreground outline-none"
        >
          <option value="none">No project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto flex flex-col">
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
