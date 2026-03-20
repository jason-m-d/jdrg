'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowDown, Loader2, Trash2, FileText, X } from 'lucide-react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { ChatMessages } from '@/components/chat-messages'
import { ChatInput, type ChatInputHandle } from '@/components/chat-input'
import { ArtifactPanel } from '@/components/artifact-panel'
import type { Artifact } from '@/lib/types'

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [messages, setMessages] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [projectId, setProjectId] = useState<string>('none')
  const [projects, setProjects] = useState<any[]>([])
  const [convTitle, setConvTitle] = useState<string>('')
  const [streamingContent, setStreamingContent] = useState('')
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [openArtifactIds, setOpenArtifactIds] = useState<string[]>([])
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null)
  const [showArtifactPanel, setShowArtifactPanel] = useState(false)
  const chatInputRef = useRef<ChatInputHandle>(null)
  const [showScrollButton, setShowScrollButton] = useState(false)

  // Track scroll position to show/hide "scroll to latest" button
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    function handleScroll() {
      if (!container) return
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
      setShowScrollButton(distanceFromBottom > 200)
    }
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
    }
  }, [])

  useEffect(() => {
    const supabase = getSupabaseBrowser()

    supabase.from('projects').select('id, name, color').order('name')
      .then(({ data }) => setProjects(data || []))

    supabase.from('conversations').select('project_id, title').eq('id', id).single()
      .then(({ data }) => {
        setProjectId(data?.project_id || 'none')
        setConvTitle(data?.title || '')
      })

    supabase.from('messages').select('*').eq('conversation_id', id).order('created_at')
      .then(({ data }) => {
        setMessages(data || [])
        setInitialLoading(false)
      })

    supabase.from('artifacts').select('*').eq('conversation_id', id).order('updated_at', { ascending: false })
      .then(({ data }) => {
        if (data && data.length > 0) setArtifacts(data)
      })
  }, [id])

  async function handleSubmit(userMessage: string, model?: string, _prefetchCacheKey?: string) {
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
          conversation_id: id,
          project_id: projectId === 'none' ? null : projectId,
          active_artifact_id: activeArtifactId,
          model,
        }),
      })

      if (!res.ok) throw new Error(`Chat request failed: ${res.status}`)
      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response stream')
      const decoder = new TextDecoder()
      let fullText = ''
      let sources: any[] = []
      const actionItemEvents: any[] = []
      const addToProjectEvents: any[] = []
      const artifactEvents: any[] = []
      const gmailSearchEvents: any[] = []
      const trainingEvents: any[] = []
      const structuredQuestionEvents: any[] = []
      const quickConfirmEvents: any[] = []
      let buffer = ''

      while (reader) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
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
              }
              if (data.project_context) {
                addToProjectEvents.push(data.project_context)
              }
              if (data.gmail_search) {
                gmailSearchEvents.push(data.gmail_search)
              }
              if (data.training) {
                trainingEvents.push(data.training)
              }
              if (data.structured_question) {
                structuredQuestionEvents.push(data.structured_question)
              }
              if (data.quick_confirm) {
                quickConfirmEvents.push(data.quick_confirm)
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
        trainingEvents: trainingEvents.length > 0 ? trainingEvents : undefined,
        structuredQuestionEvents: structuredQuestionEvents.length > 0 ? structuredQuestionEvents : undefined,
        quickConfirmEvents: quickConfirmEvents.length > 0 ? quickConfirmEvents : undefined,
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
    setOpenArtifactIds(prev => prev.filter(aid => aid !== artifactId))
    if (activeArtifactId === artifactId) {
      const remaining = openArtifactIds.filter(aid => aid !== artifactId)
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
        {/* Header */}
        <div className="flex items-center gap-4 border-b border-border px-6 py-3">
          <span className="text-[0.8125rem] font-medium uppercase tracking-[0.1em]">Chat</span>
          {convTitle && (
            <>
              <div className="w-px h-4 bg-border" />
              <span className="text-[0.75rem] text-muted-foreground/50 truncate">{convTitle}</span>
            </>
          )}
          <div className="w-px h-4 bg-border" />
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="bg-transparent text-[0.75rem] text-muted-foreground outline-none"
          >
            <option value="none">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => {
                if (showArtifactPanel) {
                  setShowArtifactPanel(false)
                } else {
                  if (artifacts.length > 0) {
                    setOpenArtifactIds(artifacts.map(a => a.id))
                    setActiveArtifactId(activeArtifactId || artifacts[0].id)
                  }
                  setShowArtifactPanel(true)
                }
              }}
              className={`relative p-1 transition-colors ${showArtifactPanel ? 'text-foreground/70' : 'text-muted-foreground/30 hover:text-foreground/50'}`}
              title="Artifacts"
            >
              <FileText className="size-3.5" />
              {artifacts.length > 0 && (
                <span className="absolute -top-1 -right-1.5 text-[0.5625rem] font-medium text-muted-foreground/50">{artifacts.length}</span>
              )}
            </button>
            <button
              onClick={async () => {
                if (!confirm('Delete this conversation?')) return
                const supabase = getSupabaseBrowser()
                await supabase.from('messages').delete().eq('conversation_id', id)
                await supabase.from('conversations').delete().eq('id', id)
                router.push('/')
              }}
              className="p-1 text-muted-foreground/30 hover:text-red-500 transition-colors"
              title="Delete conversation"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollContainerRef} className="flex-1 overflow-auto flex flex-col">
          <ChatMessages
            messages={messages}
            streamingContent={streamingContent}
            loading={loading}
            toolStatus={toolStatus}
            scrollContainerRef={scrollContainerRef}
            onArtifactClick={handleArtifactClick}
            onCopyMessage={(content) => {
              chatInputRef.current?.setInputText(content)
            }}
            onEditMessage={(messageIndex, content) => {
              // Remove this message and all messages after it, then put text in input
              setMessages(prev => prev.slice(0, messageIndex))
              chatInputRef.current?.setInputText(content)
            }}
            onSendMessage={(text) => {
              if (text.startsWith('__EDIT__')) {
                chatInputRef.current?.setInputText(text.slice(8))
              } else {
                handleSubmit(text)
              }
            }}
          />
        </div>

        {showScrollButton && (
          <div className="flex justify-center -mb-2 relative z-10">
            <button
              onClick={scrollToBottom}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/80 backdrop-blur-sm border border-border/40 text-muted-foreground/70 hover:text-foreground hover:bg-muted transition-all text-[0.75rem] shadow-sm"
            >
              <ArrowDown className="size-3" />
              Latest
            </button>
          </div>
        )}

        <ChatInput ref={chatInputRef} onSubmit={handleSubmit} loading={loading} storageKey={id} />
      </div>

      {showArtifactPanel && (
        openArtifacts.length > 0 ? (
        <ArtifactPanel
          artifacts={openArtifacts}
          activeArtifactId={activeArtifactId}
          onSelectArtifact={setActiveArtifactId}
          onCloseArtifact={handleCloseArtifact}
          onClosePanel={() => setShowArtifactPanel(false)}
          onArtifactUpdated={handleArtifactUpdated}
          projects={projects}
        />
        ) : (
        <div className="w-96 border-l border-border flex flex-col shrink-0 bg-background">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-[0.75rem] font-medium uppercase tracking-[0.08em] text-muted-foreground/60">Artifacts</span>
            <button onClick={() => setShowArtifactPanel(false)} className="p-0.5 text-muted-foreground/40 hover:text-foreground/60 transition-colors">
              <X className="size-3.5" />
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center">
            <p className="text-[0.75rem] text-muted-foreground/40">No artifacts yet</p>
          </div>
        </div>
        )
      )}
    </div>
  )
}
