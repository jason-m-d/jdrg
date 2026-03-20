'use client'

import { useState, useRef, useCallback, useEffect, useImperativeHandle, forwardRef } from 'react'
import {
  Loader2, ArrowUp, Paperclip, X, FileText, ChevronDown,
  Mail, Calendar, TrendingUp, CheckSquare, MessageSquare,
  Globe, Brain, Users, StickyNote, LayoutDashboard,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Local regex classifier — mirrors intent-classifier.ts domain → chip mapping.
// Runs synchronously on each keystroke to show chips instantly, before the
// AI prefetch round-trip completes.
// ---------------------------------------------------------------------------
function classifyLocal(text: string): string[] {
  const lower = text.toLowerCase().trim()
  const chips: string[] = []

  if (/email|draft|send|forward|reply|inbox|gmail/.test(lower)) chips.push('Email')
  if (/calendar|meeting|schedule|free|busy/.test(lower)) chips.push('Calendar')
  if (/\bsales\b|revenue|\bstore\b|how did|performance|wingstop|pickle|forecast|budget/.test(lower)) chips.push('Sales')
  if (/\btask\b|\btasks\b|action item|todo|to-do/.test(lower)) chips.push('Tasks')
  if (/\btext\b|sms|imessage/.test(lower)) chips.push('Texts')
  if (/search|look up|google|find out|what is|who is|latest|news/.test(lower)) chips.push('Web Search')
  if (/document|upload|pdf|file|attachment/.test(lower)) chips.push('Documents')
  if (/contact|phone number|email address|reach out/.test(lower)) chips.push('Contacts')
  if (/notepad|\bnote\b|remind me|jot|write down/.test(lower)) chips.push('Notes')
  if (/dashboard|\bcard\b|\bpin\b/.test(lower)) chips.push('Dashboard')

  return chips
}

interface UploadedFile {
  id: string
  name: string
  uploading: boolean
}

const MODELS = [
  { id: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
  { id: 'anthropic/claude-opus-4.6', label: 'Claude Opus 4.6' },
  { id: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
  { id: 'openai/gpt-5.4', label: 'GPT-5.4' },
]

// Specialist name → icon + label
const SPECIALIST_META: Record<string, { icon: React.ElementType; label: string }> = {
  Email:        { icon: Mail,            label: 'Email' },
  Calendar:     { icon: Calendar,        label: 'Calendar' },
  Sales:        { icon: TrendingUp,      label: 'Sales' },
  Tasks:        { icon: CheckSquare,     label: 'Tasks' },
  Texts:        { icon: MessageSquare,   label: 'Texts' },
  'Web Search': { icon: Globe,           label: 'Web Search' },
  Documents:    { icon: FileText,        label: 'Documents' },
  Contacts:     { icon: Users,           label: 'Contacts' },
  Notes:        { icon: StickyNote,      label: 'Notes' },
  Dashboard:    { icon: LayoutDashboard, label: 'Dashboard' },
  Memory:       { icon: Brain,           label: 'Memory' },
}

interface ChatInputProps {
  onSubmit: (message: string, model: string, prefetchCacheKey?: string) => void
  loading: boolean
  storageKey?: string
}

export interface ChatInputHandle {
  setInputText: (text: string) => void
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput({ onSubmit, loading, storageKey }, ref) {
  const lsKey = storageKey ? `chat-draft:${storageKey}` : null
  const [input, setInput] = useState(() => {
    if (typeof window === 'undefined' || !lsKey) return ''
    return localStorage.getItem(lsKey) || ''
  })
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [model, setModel] = useState(MODELS[0].id)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)

  // Prefetch state
  const [specialists, setSpecialists] = useState<string[]>([])
  const [autocompleteSuggestion, setAutocompleteSuggestion] = useState<string | null>(null)
  const prefetchTimerRef = useRef<NodeJS.Timeout | null>(null)
  const lastPrefetchCacheKey = useRef<string>('')
  // Track which specialist set is "stable" (already rendered) vs incoming
  const prevSpecialistsRef = useRef<string[]>([])

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useImperativeHandle(ref, () => ({
    setInputText(text: string) {
      setInput(text)
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto'
          textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
          textareaRef.current.focus()
        }
      }, 0)
    }
  }))

  // Persist draft to localStorage
  useEffect(() => {
    if (!lsKey) return
    if (input) {
      localStorage.setItem(lsKey, input)
    } else {
      localStorage.removeItem(lsKey)
    }
  }, [input, lsKey])

  // Restore textarea height on mount if there's a draft
  useEffect(() => {
    if (input && textareaRef.current) {
      const el = textareaRef.current
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 200) + 'px'
    }
  }, [])

  // Cleanup prefetch timer on unmount
  useEffect(() => {
    return () => {
      if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current)
    }
  }, [])

  // Fire prefetch when input changes
  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setInput(value)
    setAutocompleteSuggestion(null) // dismiss stale suggestion immediately on any keystroke

    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'

    // Clear previous debounce
    if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current)

    if (value.trim().length <= 3) {
      setSpecialists([])
      return
    }

    // Show chips instantly from local regex classifier — no network needed
    const localChips = classifyLocal(value.trim())
    prevSpecialistsRef.current = specialists
    setSpecialists(localChips)

    // Then refine with AI prefetch after 250ms debounce
    prefetchTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/chat/prefetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ partial_message: value.trim() }),
        })
        if (!res.ok) return
        const data = await res.json()

        // Refine specialists with AI result — stable ones stay, new ones animate in
        prevSpecialistsRef.current = specialists
        setSpecialists(data.specialists || [])

        // Store cache key for the submit
        lastPrefetchCacheKey.current = data.cache_key || ''

        // Set autocomplete suggestion if cursor is at end
        const ta = textareaRef.current
        if (
          data.autocomplete?.length > 0 &&
          ta &&
          ta.selectionStart === ta.value.length &&
          ta.value.trim().length > 0
        ) {
          setAutocompleteSuggestion(data.autocomplete[0].text)
        }
      } catch {
        // silently ignore prefetch errors — they're speculative
      }
    }, 250)
  }, [specialists])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Accept autocomplete with Tab or ArrowRight at end of input
    if (autocompleteSuggestion && (e.key === 'Tab' || e.key === 'ArrowRight')) {
      const ta = e.currentTarget
      if (ta.selectionStart === ta.value.length) {
        e.preventDefault()
        const newValue = input + autocompleteSuggestion
        setInput(newValue)
        setAutocompleteSuggestion(null)
        // Re-trigger prefetch for new value immediately
        if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current)
        prefetchTimerRef.current = setTimeout(async () => {
          try {
            const res = await fetch('/api/chat/prefetch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ partial_message: newValue.trim() }),
            })
            if (!res.ok) return
            const data = await res.json()
            setSpecialists(data.specialists || [])
            lastPrefetchCacheKey.current = data.cache_key || ''
          } catch { /* ignore */ }
        }, 100) // shorter delay after accept
        return
      }
    }

    // Dismiss autocomplete with Escape
    if (e.key === 'Escape' && autocompleteSuggestion) {
      setAutocompleteSuggestion(null)
      return
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }, [input, loading, files, autocompleteSuggestion])

  function handleSubmit() {
    const hasFiles = files.some(f => !f.uploading)
    if ((!input.trim() && !hasFiles) || loading) return
    if (files.some(f => f.uploading)) return

    let message = input.trim()
    const uploadedFiles = files.filter(f => !f.uploading)
    if (uploadedFiles.length > 0) {
      const fileList = uploadedFiles.map(f => f.name).join(', ')
      const prefix = `[Uploaded: ${fileList}]\n\n`
      message = message ? prefix + message : prefix + `I just uploaded ${uploadedFiles.length === 1 ? 'a document' : 'some documents'}. Please review.`
    }

    const cacheKey = lastPrefetchCacheKey.current

    setInput('')
    setFiles([])
    setSpecialists([])
    setAutocompleteSuggestion(null)
    lastPrefetchCacheKey.current = ''
    if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current)
    if (lsKey) localStorage.removeItem(lsKey)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    onSubmit(message, model, cacheKey || undefined)
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = e.target.files
    if (!selectedFiles) return

    for (const file of Array.from(selectedFiles)) {
      const tempId = crypto.randomUUID()
      const fileEntry: UploadedFile = { id: tempId, name: file.name, uploading: true }
      setFiles(prev => [...prev, fileEntry])

      try {
        const formData = new FormData()
        formData.append('file', file)

        const res = await fetch('/api/documents/upload', {
          method: 'POST',
          body: formData,
        })

        if (!res.ok) throw new Error('Upload failed')
        const doc = await res.json()

        setFiles(prev => prev.map(f =>
          f.id === tempId ? { ...f, id: doc.id, uploading: false } : f
        ))
      } catch (err) {
        console.error('Upload error:', err)
        setFiles(prev => prev.filter(f => f.id !== tempId))
      }
    }

    e.target.value = ''
  }

  function removeFile(fileId: string) {
    setFiles(prev => prev.filter(f => f.id !== fileId))
  }

  function dismissSpecialist(label: string) {
    setSpecialists(prev => prev.filter(s => s !== label))
  }

  const canSend = (input.trim() || files.some(f => !f.uploading)) && !loading && !files.some(f => f.uploading)
  const prevSet = new Set(prevSpecialistsRef.current)

  return (
    <div>
      <div className="max-w-[740px] mx-auto px-8 pb-3">
        {/* Specialist chips — outside the input box, above it */}
        {specialists.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {specialists.map(s => {
              const meta = SPECIALIST_META[s]
              if (!meta) return null
              const Icon = meta.icon
              const isNew = !prevSet.has(s)
              return (
                <div
                  key={s}
                  className="group flex items-center gap-1 px-2 py-0.5 text-[0.7rem] text-muted-foreground bg-muted/30 border border-border/50 rounded-full transition-all duration-150 ease-out"
                  style={{
                    animation: isNew ? 'chip-enter 150ms ease-out both' : undefined,
                  }}
                >
                  <Icon className="size-3 shrink-0" />
                  <span>{meta.label}</span>
                  <button
                    onClick={() => dismissSpecialist(s)}
                    className="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-100"
                    aria-label={`Remove ${meta.label}`}
                  >
                    <X className="size-2.5" />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        <div className="border border-border input-container shadow-sm">
          {/* Attached files */}
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3.5 pt-3">
              {files.map(f => (
                <div
                  key={f.id}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-muted/50 border border-border text-xs"
                >
                  {f.uploading ? (
                    <Loader2 className="size-3 animate-spin text-muted-foreground" />
                  ) : (
                    <FileText className="size-3 text-muted-foreground" />
                  )}
                  <span className="max-w-[150px] truncate">{f.name}</span>
                  {!f.uploading && (
                    <button
                      onClick={() => removeFile(f.id)}
                      className="text-muted-foreground hover:text-foreground ml-0.5"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Input row with ghost text overlay */}
          <div className="flex items-center gap-1 relative">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex-shrink-0 ml-1.5 p-1.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
              title="Attach file"
            >
              <Paperclip className="size-4" />
            </button>

            {/* Ghost text overlay — sits exactly over the textarea */}
            <div className="relative flex-1">
              {autocompleteSuggestion && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 py-3 pr-2 text-[0.9375rem] leading-relaxed whitespace-pre-wrap break-words overflow-hidden"
                  style={{ paddingLeft: 0 }}
                >
                  {/* Invisible spacer matching the typed text */}
                  <span className="invisible">{input}</span>
                  {/* Ghost continuation */}
                  <span className="text-muted-foreground/30">{autocompleteSuggestion}</span>
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                placeholder="Message..."
                rows={1}
                className="w-full resize-none bg-transparent py-3 pr-2 text-[0.9375rem] leading-relaxed outline-none placeholder:text-muted-foreground/40"
                style={{ minHeight: '46px', maxHeight: '200px' }}
              />
            </div>

            <button
              onClick={handleSubmit}
              disabled={!canSend}
              className="flex-shrink-0 mr-2.5 p-1.5 bg-foreground text-background disabled:opacity-20 transition-opacity"
            >
              {loading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ArrowUp className="size-3.5" />
              )}
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.xlsx,.xls,.txt,.csv,.md"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>

        {/* Model picker */}
        <div className="relative mt-2 flex items-center">
          <button
            onClick={() => setModelPickerOpen(o => !o)}
            className="flex items-center gap-1 text-[0.7rem] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            {MODELS.find(m => m.id === model)?.label}
            <ChevronDown className="size-3" />
          </button>
          {modelPickerOpen && (
            <div className="absolute bottom-6 left-0 z-10 border border-border bg-background shadow-md min-w-[160px]">
              {MODELS.map(m => (
                <button
                  key={m.id}
                  onClick={() => { setModel(m.id); setModelPickerOpen(false) }}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors ${m.id === model ? 'text-foreground' : 'text-muted-foreground'}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  )
})
