'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import {
  Loader2, FileText, MessageSquare, Pin, PinOff, ArrowUp, Settings2,
  Upload, Plus, Trash2, X, Check, PanelLeftClose, PanelLeftOpen, BookOpen, Pencil
} from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { ChatMessages } from '@/components/chat-messages'

const COLORS = ['#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#EC4899', '#6B7280', '#06B6D4']

type Panel = 'conversations' | 'files' | 'context' | 'settings'

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [project, setProject] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  // Chat state
  const [conversations, setConversations] = useState<any[]>([])
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<any[]>([])
  const [input, setInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [messagesLoading, setMessagesLoading] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Panel state
  const [panel, setPanel] = useState<Panel | null>('conversations')

  // Files state
  const [documents, setDocuments] = useState<any[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [showAddDoc, setShowAddDoc] = useState(false)
  const [availableDocs, setAvailableDocs] = useState<any[]>([])
  const [loadingDocs, setLoadingDocs] = useState(false)

  // Context state
  const [contextEntries, setContextEntries] = useState<any[]>([])
  const [editingContextId, setEditingContextId] = useState<string | null>(null)
  const [contextTitle, setContextTitle] = useState('')
  const [contextContent, setContextContent] = useState('')
  const [savingContext, setSavingContext] = useState(false)
  const [addingContext, setAddingContext] = useState(false)

  // Edit state
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editColor, setEditColor] = useState('#3B82F6')
  const [editPrompt, setEditPrompt] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadProject() }, [id])

  async function loadProject() {
    const supabase = getSupabaseBrowser()
    const [{ data: proj }, { data: convos }, { data: docs }, { data: ctxEntries }] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase.from('conversations').select('*').eq('project_id', id).order('updated_at', { ascending: false }),
      supabase.from('documents').select('*').eq('project_id', id).order('is_pinned', { ascending: false }).order('updated_at', { ascending: false }),
      supabase.from('project_context').select('*').eq('project_id', id).order('updated_at', { ascending: false }),
    ])

    setProject(proj)
    setConversations(convos || [])
    setDocuments(docs || [])
    setContextEntries(ctxEntries || [])
    setLoading(false)

    if (proj) {
      setEditName(proj.name)
      setEditDescription(proj.description || '')
      setEditColor(proj.color || '#3B82F6')
      setEditPrompt(proj.system_prompt || '')
    }
  }

  async function loadConversation(convId: string) {
    setActiveConvId(convId)
    setMessages([])
    setMessagesLoading(true)
    const { data } = await getSupabaseBrowser()
      .from('messages')
      .select('*')
      .eq('conversation_id', convId)
      .order('created_at')
    setMessages(data || [])
    setMessagesLoading(false)
  }

  function startNewChat() {
    setActiveConvId(null)
    setMessages([])
  }

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    if (!input.trim() || chatLoading) return

    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setChatLoading(true)
    setStreamingContent('')

    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          conversation_id: activeConvId,
          project_id: id,
        }),
      })

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let fullText = ''
      let sources: any[] = []
      const actionItemEvents: any[] = []
      const addToProjectEvents: any[] = []

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
              if (data.add_to_project) {
                addToProjectEvents.push(data.add_to_project)
              }
              if (data.done) {
                if (data.sources) sources = data.sources
                // If this was a new conversation, update state
                if (!activeConvId && data.conversation_id) {
                  setActiveConvId(data.conversation_id)
                  // Refresh conversation list
                  const { data: convos } = await getSupabaseBrowser()
                    .from('conversations')
                    .select('*')
                    .eq('project_id', id)
                    .order('updated_at', { ascending: false })
                  setConversations(convos || [])
                }
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
      }])
      setStreamingContent('')
    } catch (err) {
      console.error(err)
      setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.' }])
    } finally {
      setChatLoading(false)
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

  // Project actions
  async function handleSave() {
    if (!editName.trim()) return
    setSaving(true)
    const res = await fetch(`/api/projects/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editName.trim(),
        description: editDescription.trim() || null,
        color: editColor,
        system_prompt: editPrompt.trim() || null,
      }),
    })
    const updated = await res.json()
    setProject(updated)
    setEditing(false)
    setSaving(false)
  }

  async function handleDelete() {
    if (!confirm(`Delete "${project.name}"? Documents and conversations will be unlinked, not deleted.`)) return
    await fetch(`/api/projects/${id}`, { method: 'DELETE' })
    router.push('/projects')
  }

  // File actions
  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const formData = new FormData()
    formData.append('file', file)
    formData.append('project_id', id)
    await fetch('/api/documents/upload', { method: 'POST', body: formData })
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    const { data: docs } = await getSupabaseBrowser()
      .from('documents').select('*').eq('project_id', id)
      .order('is_pinned', { ascending: false }).order('updated_at', { ascending: false })
    setDocuments(docs || [])
  }

  async function togglePin(docId: string, currentlyPinned: boolean) {
    await getSupabaseBrowser().from('documents').update({ is_pinned: !currentlyPinned }).eq('id', docId)
    setDocuments(prev => prev.map(d => d.id === docId ? { ...d, is_pinned: !currentlyPinned } : d))
  }

  async function removeFromProject(docId: string) {
    await getSupabaseBrowser().from('documents').update({ project_id: null, is_pinned: false }).eq('id', docId)
    setDocuments(prev => prev.filter(d => d.id !== docId))
  }

  async function openAddDoc() {
    setShowAddDoc(true)
    setLoadingDocs(true)
    const { data } = await getSupabaseBrowser()
      .from('documents').select('id, title, file_type').is('project_id', null)
      .order('updated_at', { ascending: false }).limit(50)
    setAvailableDocs(data || [])
    setLoadingDocs(false)
  }

  async function addDocToProject(docId: string) {
    await getSupabaseBrowser().from('documents').update({ project_id: id }).eq('id', docId)
    setAvailableDocs(prev => prev.filter(d => d.id !== docId))
    const { data: docs } = await getSupabaseBrowser()
      .from('documents').select('*').eq('project_id', id)
      .order('is_pinned', { ascending: false }).order('updated_at', { ascending: false })
    setDocuments(docs || [])
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="size-4 animate-spin text-muted-foreground/40" />
      </div>
    )
  }

  if (!project) return <div className="p-6 text-[13px] text-muted-foreground">Project not found</div>

  return (
    <div className="h-full flex animate-in-fade">
      {/* Side panel */}
      {panel && (
        <div className="w-48 border-r border-border flex flex-col shrink-0 bg-background">
          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2 min-w-0">
              <div className="size-2.5 shrink-0" style={{ backgroundColor: project.color }} />
              <span className="text-[12px] font-medium truncate">{project.name}</span>
            </div>
            <button
              onClick={() => setPanel(null)}
              className="p-1 text-muted-foreground/40 hover:text-foreground transition-colors shrink-0"
            >
              <PanelLeftClose className="size-3.5" />
            </button>
          </div>

          {/* Panel tabs */}
          <div className="flex border-b border-border">
            {([
              { key: 'conversations' as Panel, icon: MessageSquare },
              { key: 'files' as Panel, icon: FileText },
              { key: 'context' as Panel, icon: BookOpen },
              { key: 'settings' as Panel, icon: Settings2 },
            ]).map(t => (
              <button
                key={t.key}
                onClick={() => setPanel(t.key)}
                className={cn(
                  "flex-1 flex items-center justify-center py-2.5 border-b-2 transition-colors",
                  panel === t.key
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground/40 hover:text-muted-foreground'
                )}
              >
                <t.icon className="size-3.5" />
              </button>
            ))}
          </div>

          {/* Panel content */}
          <div className="flex-1 overflow-auto">
            {/* Conversations panel */}
            {panel === 'conversations' && (
              <div>
                <button
                  onClick={startNewChat}
                  className="w-full flex items-center gap-2 px-4 py-3 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors border-b border-border"
                >
                  <Plus className="size-3" />
                  New conversation
                </button>
                {conversations.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground/40 px-4 py-6 text-center">No conversations yet</p>
                ) : (
                  <div>
                    {conversations.map(conv => (
                      <button
                        key={conv.id}
                        onClick={() => loadConversation(conv.id)}
                        className={cn(
                          "w-full text-left px-4 py-2.5 text-[12px] transition-colors border-b border-border truncate",
                          activeConvId === conv.id
                            ? 'bg-muted/50 text-foreground font-medium'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
                        )}
                      >
                        {conv.title || 'Untitled'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Files panel */}
            {panel === 'files' && (
              <div>
                <div className="flex gap-1 px-3 py-3 border-b border-border">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] bg-foreground text-background transition-opacity hover:opacity-80 disabled:opacity-30"
                  >
                    {uploading ? <Loader2 className="size-2.5 animate-spin" /> : <Upload className="size-2.5" />}
                    Upload
                  </button>
                  <button
                    onClick={openAddDoc}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] border border-border text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Plus className="size-2.5" />
                    Add
                  </button>
                  <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.docx,.xlsx,.xls,.txt,.csv,.md" onChange={handleUpload} />
                </div>
                {documents.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground/40 px-4 py-6 text-center">No files</p>
                ) : (
                  <div>
                    {documents.map(doc => (
                      <div key={doc.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors group border-b border-border">
                        <FileText className="size-3 text-muted-foreground/40 shrink-0" />
                        <Link href={`/documents/${doc.id}`} className="text-[11px] truncate flex-1 text-muted-foreground hover:text-foreground">
                          {doc.title}
                        </Link>
                        {doc.is_pinned && <Pin className="size-2.5 text-muted-foreground/40 shrink-0" />}
                        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <button onClick={() => togglePin(doc.id, doc.is_pinned)} className="p-0.5 text-muted-foreground/40 hover:text-foreground transition-colors" title={doc.is_pinned ? 'Unpin' : 'Pin'}>
                            {doc.is_pinned ? <PinOff className="size-2.5" /> : <Pin className="size-2.5" />}
                          </button>
                          <button onClick={() => removeFromProject(doc.id)} className="p-0.5 text-muted-foreground/40 hover:text-destructive transition-colors" title="Remove">
                            <X className="size-2.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Context panel */}
            {panel === 'context' && (
              <div>
                <button
                  onClick={() => { setAddingContext(true); setContextTitle(''); setContextContent('') }}
                  className="w-full flex items-center gap-2 px-4 py-3 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors border-b border-border"
                >
                  <Plus className="size-3" />
                  Add context
                </button>

                {addingContext && (
                  <div className="p-3 border-b border-border space-y-2">
                    <input
                      value={contextTitle}
                      onChange={(e) => setContextTitle(e.target.value)}
                      placeholder="Title"
                      className="w-full bg-transparent border border-border px-2 py-1 text-[11px] outline-none focus:border-foreground/30 transition-colors"
                      autoFocus
                    />
                    <textarea
                      value={contextContent}
                      onChange={(e) => setContextContent(e.target.value)}
                      placeholder="Context content..."
                      className="w-full bg-transparent border border-border px-2 py-1.5 text-[11px] outline-none focus:border-foreground/30 transition-colors min-h-[80px] resize-y leading-relaxed"
                    />
                    <div className="flex gap-1.5">
                      <button
                        onClick={async () => {
                          if (!contextTitle.trim()) return
                          setSavingContext(true)
                          await fetch('/api/project-context', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ project_id: id, title: contextTitle.trim(), content: contextContent.trim() }),
                          })
                          const { data } = await getSupabaseBrowser()
                            .from('project_context').select('*').eq('project_id', id)
                            .order('updated_at', { ascending: false })
                          setContextEntries(data || [])
                          setAddingContext(false)
                          setSavingContext(false)
                        }}
                        disabled={savingContext || !contextTitle.trim()}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] bg-foreground text-background transition-opacity hover:opacity-80 disabled:opacity-30"
                      >
                        {savingContext ? <Loader2 className="size-2.5 animate-spin" /> : <Check className="size-2.5" />}
                        Save
                      </button>
                      <button
                        onClick={() => setAddingContext(false)}
                        className="px-2 py-1 text-[10px] border border-border text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {contextEntries.length === 0 && !addingContext ? (
                  <p className="text-[11px] text-muted-foreground/40 px-4 py-6 text-center">No context entries</p>
                ) : (
                  <div>
                    {contextEntries.map(ctx => (
                      <div key={ctx.id} className="border-b border-border">
                        {editingContextId === ctx.id ? (
                          <div className="p-3 space-y-2">
                            <input
                              value={contextTitle}
                              onChange={(e) => setContextTitle(e.target.value)}
                              className="w-full bg-transparent border border-border px-2 py-1 text-[11px] font-medium outline-none focus:border-foreground/30 transition-colors"
                              autoFocus
                            />
                            <textarea
                              value={contextContent}
                              onChange={(e) => setContextContent(e.target.value)}
                              className="w-full bg-transparent border border-border px-2 py-1.5 text-[11px] outline-none focus:border-foreground/30 transition-colors min-h-[80px] resize-y leading-relaxed"
                            />
                            <div className="flex gap-1.5">
                              <button
                                onClick={async () => {
                                  if (!contextTitle.trim()) return
                                  setSavingContext(true)
                                  await fetch(`/api/project-context/${ctx.id}`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ title: contextTitle.trim(), content: contextContent.trim() }),
                                  })
                                  const { data } = await getSupabaseBrowser()
                                    .from('project_context').select('*').eq('project_id', id)
                                    .order('updated_at', { ascending: false })
                                  setContextEntries(data || [])
                                  setEditingContextId(null)
                                  setSavingContext(false)
                                }}
                                disabled={savingContext || !contextTitle.trim()}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[10px] bg-foreground text-background transition-opacity hover:opacity-80 disabled:opacity-30"
                              >
                                {savingContext ? <Loader2 className="size-2.5 animate-spin" /> : <Check className="size-2.5" />}
                                Save
                              </button>
                              <button
                                onClick={() => setEditingContextId(null)}
                                className="px-2 py-1 text-[10px] border border-border text-muted-foreground hover:text-foreground transition-colors"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={async () => {
                                  if (!confirm('Delete this context entry?')) return
                                  await fetch(`/api/project-context/${ctx.id}`, { method: 'DELETE' })
                                  setContextEntries(prev => prev.filter(c => c.id !== ctx.id))
                                  setEditingContextId(null)
                                }}
                                className="ml-auto px-2 py-1 text-[10px] text-muted-foreground/40 hover:text-destructive transition-colors"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div
                            className="px-3 py-2.5 hover:bg-muted/30 transition-colors cursor-pointer group"
                            onClick={() => { setEditingContextId(ctx.id); setContextTitle(ctx.title); setContextContent(ctx.content) }}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-medium truncate flex-1">{ctx.title}</span>
                              <Pencil className="size-2.5 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                            </div>
                            <p className="text-[10px] text-muted-foreground/40 mt-0.5 line-clamp-2 leading-relaxed">{ctx.content}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Settings panel */}
            {panel === 'settings' && (
              <div className="p-4 space-y-4">
                {editing ? (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium">Name</label>
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full bg-transparent border border-border px-2.5 py-1.5 text-[12px] outline-none focus:border-foreground/30 transition-colors"
                        autoFocus
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium">Description</label>
                      <input
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        placeholder="Brief description"
                        className="w-full bg-transparent border border-border px-2.5 py-1.5 text-[12px] outline-none placeholder:text-muted-foreground/30 focus:border-foreground/30 transition-colors"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium">Color</label>
                      <div className="flex gap-1.5 flex-wrap">
                        {COLORS.map(c => (
                          <button
                            key={c}
                            onClick={() => setEditColor(c)}
                            className={cn("size-5 border-2 transition-colors", editColor === c ? 'border-foreground' : 'border-transparent')}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={handleSave} disabled={saving || !editName.trim()} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] bg-foreground text-background transition-opacity hover:opacity-80 disabled:opacity-30">
                        {saving ? <Loader2 className="size-2.5 animate-spin" /> : <Check className="size-2.5" />}
                        Save
                      </button>
                      <button onClick={() => { setEditing(false); setEditName(project.name); setEditDescription(project.description || ''); setEditColor(project.color || '#3B82F6') }} className="px-2.5 py-1.5 text-[11px] border border-border text-muted-foreground hover:text-foreground transition-colors">
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium block mb-1">Project</span>
                      <p className="text-[13px] font-medium">{project.name}</p>
                      {project.description && <p className="text-[11px] text-muted-foreground/60 mt-0.5">{project.description}</p>}
                    </div>
                    <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] border border-border text-muted-foreground hover:text-foreground transition-colors">
                      <Settings2 className="size-2.5" /> Edit Details
                    </button>
                  </>
                )}

                <div className="pt-2 border-t border-border space-y-1.5">
                  <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium block">Instructions</label>
                  <p className="text-[10px] text-muted-foreground/40 leading-relaxed">Custom system prompt for AI conversations in this project.</p>
                  <textarea
                    value={editPrompt}
                    onChange={(e) => setEditPrompt(e.target.value)}
                    placeholder="e.g. Focus on financial analysis..."
                    className="w-full bg-transparent border border-border px-2.5 py-2 text-[11px] outline-none placeholder:text-muted-foreground/30 focus:border-foreground/30 transition-colors min-h-[120px] resize-y leading-relaxed"
                  />
                  <button
                    onClick={async () => {
                      setSaving(true)
                      await fetch(`/api/projects/${id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ system_prompt: editPrompt.trim() || null }),
                      })
                      setProject((prev: any) => ({ ...prev, system_prompt: editPrompt.trim() || null }))
                      setSaving(false)
                    }}
                    disabled={saving || editPrompt === (project.system_prompt || '')}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] bg-foreground text-background transition-opacity hover:opacity-80 disabled:opacity-30"
                  >
                    {saving ? <Loader2 className="size-2.5 animate-spin" /> : <Check className="size-2.5" />}
                    Save Instructions
                  </button>
                </div>

                <div className="pt-4 border-t border-border">
                  <button onClick={handleDelete} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-destructive hover:bg-destructive/10 transition-colors border border-destructive/30">
                    <Trash2 className="size-2.5" /> Delete Project
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Chat header */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          {!panel && (
            <button onClick={() => setPanel('conversations')} className="p-1 text-muted-foreground/40 hover:text-foreground transition-colors">
              <PanelLeftOpen className="size-4" />
            </button>
          )}
          <div className="size-2.5" style={{ backgroundColor: project.color }} />
          <span className="text-[13px] font-medium">{project.name}</span>
          {activeConvId && (
            <>
              <div className="w-px h-4 bg-border" />
              <span className="text-[12px] text-muted-foreground/50 truncate">
                {conversations.find(c => c.id === activeConvId)?.title || 'Untitled'}
              </span>
            </>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-auto flex flex-col">
          {messagesLoading ? (
            <div className="flex items-center justify-center flex-1">
              <Loader2 className="size-4 animate-spin text-muted-foreground/40" />
            </div>
          ) : (
            <ChatMessages
              messages={messages}
              streamingContent={streamingContent}
              loading={chatLoading}
            />
          )}
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
                disabled={chatLoading || !input.trim()}
                className="absolute bottom-2.5 right-2.5 p-1.5 bg-foreground text-background disabled:opacity-20 transition-opacity"
              >
                {chatLoading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ArrowUp className="size-3.5" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Add existing doc dialog */}
      {showAddDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-background/80" onClick={() => setShowAddDoc(false)} />
          <div className="relative bg-background border border-border w-full max-w-md max-h-[60vh] flex flex-col animate-in-up">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-[13px] font-medium uppercase tracking-[0.1em]">Add Document</h2>
              <button onClick={() => setShowAddDoc(false)} className="p-1 text-muted-foreground/40 hover:text-foreground transition-colors">
                <X className="size-3.5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto">
              {loadingDocs ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="size-4 animate-spin text-muted-foreground/40" />
                </div>
              ) : availableDocs.length === 0 ? (
                <p className="text-[12px] text-muted-foreground/40 py-8 text-center">No unassigned documents</p>
              ) : (
                <div className="divide-y divide-border">
                  {availableDocs.map(doc => (
                    <button
                      key={doc.id}
                      onClick={() => addDocToProject(doc.id)}
                      className="w-full flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors text-left"
                    >
                      <FileText className="size-3.5 text-muted-foreground/40 shrink-0" />
                      <span className="text-[13px] truncate flex-1">{doc.title}</span>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/40">{doc.file_type}</span>
                      <Plus className="size-3 text-muted-foreground/40" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
