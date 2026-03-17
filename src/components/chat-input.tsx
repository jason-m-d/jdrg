'use client'

import { useState, useRef, useCallback, useEffect, useImperativeHandle, forwardRef } from 'react'
import { Loader2, ArrowUp, Paperclip, X, FileText } from 'lucide-react'

interface UploadedFile {
  id: string
  name: string
  uploading: boolean
}

interface ChatInputProps {
  onSubmit: (message: string) => void
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
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useImperativeHandle(ref, () => ({
    setInputText(text: string) {
      setInput(text)
      // Wait for state update then resize textarea
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

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }, [input, loading, files])

  function handleSubmit() {
    const hasFiles = files.some(f => !f.uploading)
    if ((!input.trim() && !hasFiles) || loading) return
    if (files.some(f => f.uploading)) return

    // Build message with file references
    let message = input.trim()
    const uploadedFiles = files.filter(f => !f.uploading)
    if (uploadedFiles.length > 0) {
      const fileList = uploadedFiles.map(f => f.name).join(', ')
      const prefix = `[Uploaded: ${fileList}]\n\n`
      message = message ? prefix + message : prefix + `I just uploaded ${uploadedFiles.length === 1 ? 'a document' : 'some documents'}. Please review.`
    }

    setInput('')
    setFiles([])
    if (lsKey) localStorage.removeItem(lsKey)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    onSubmit(message)
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

    // Reset input so the same file can be selected again
    e.target.value = ''
  }

  function removeFile(fileId: string) {
    setFiles(prev => prev.filter(f => f.id !== fileId))
  }

  const canSend = (input.trim() || files.some(f => !f.uploading)) && !loading && !files.some(f => f.uploading)

  return (
    <div>
      <div className="max-w-3xl mx-auto px-4 pb-3">
        <div className="border border-border input-container">
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

          {/* Input row */}
          <div className="flex items-end gap-1">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex-shrink-0 mb-[9px] ml-1.5 p-1.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
              title="Attach file"
            >
              <Paperclip className="size-4" />
            </button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="Message..."
              rows={1}
              className="flex-1 resize-none bg-transparent py-3 pr-2 text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground/40"
              style={{ minHeight: '46px', maxHeight: '200px' }}
            />
            <button
              onClick={handleSubmit}
              disabled={!canSend}
              className="flex-shrink-0 mb-[9px] mr-2.5 p-1.5 bg-foreground text-background disabled:opacity-20 transition-opacity"
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
      </div>
    </div>
  )
})
