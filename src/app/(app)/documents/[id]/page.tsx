'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { Loader2, Save, History, Trash2, ArrowLeft, X } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

export default function DocumentEditorPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [doc, setDoc] = useState<any>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [projectId, setProjectId] = useState('none')
  const [isLiving, setIsLiving] = useState(false)
  const [isPinned, setIsPinned] = useState(false)
  const [isTemplate, setIsTemplate] = useState(false)
  const [projects, setProjects] = useState<any[]>([])
  const [versions, setVersions] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [hasChanges, setHasChanges] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => {
    const supabase = getSupabaseBrowser()

    supabase.from('projects').select('id, name, color').order('name')
      .then(({ data }) => setProjects(data || []))

    fetch(`/api/documents/${id}`)
      .then(r => r.json())
      .then(data => {
        setDoc(data)
        setTitle(data.title)
        setContent(data.content || '')
        setProjectId(data.project_id || 'none')
        setIsLiving(data.is_living)
        setIsPinned(data.is_pinned)
        setIsTemplate(data.is_template)
        setLoading(false)
      })

    supabase.from('document_versions')
      .select('*')
      .eq('document_id', id)
      .order('version', { ascending: false })
      .then(({ data }) => setVersions(data || []))
  }, [id])

  async function handleSave() {
    setSaving(true)
    await fetch(`/api/documents/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        content,
        project_id: projectId === 'none' ? null : projectId,
        is_living: isLiving,
        is_pinned: isPinned,
        is_template: isTemplate,
      }),
    })
    setSaving(false)
    setHasChanges(false)
  }

  async function handleDelete() {
    if (!confirm('Delete this document?')) return
    await fetch(`/api/documents/${id}`, { method: 'DELETE' })
    router.push('/documents')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="size-4 animate-spin text-muted-foreground/40" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col animate-in-fade">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-6 py-3">
        <Link href="/documents" className="p-1 text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="size-4" />
        </Link>
        <input
          value={title}
          onChange={(e) => { setTitle(e.target.value); setHasChanges(true) }}
          className="flex-1 bg-transparent text-[14px] font-medium outline-none placeholder:text-muted-foreground/30"
        />
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground/40">
            {doc?.is_living && <span className="text-green-600">Live</span>}
            <span>{doc?.file_type}</span>
            <span>v{doc?.version}</span>
          </div>

          <div className="w-px h-4 bg-border" />

          <button
            onClick={() => setShowHistory(!showHistory)}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 text-[11px] transition-colors",
              showHistory ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <History className="size-3" />
            History
          </button>

          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] bg-foreground text-background disabled:opacity-20 transition-opacity"
          >
            {saving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
            Save
          </button>

          <button
            onClick={handleDelete}
            className="p-1.5 text-muted-foreground/40 hover:text-destructive transition-colors"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Editor area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main editor */}
        <div className="flex-1 flex flex-col overflow-auto">
          <div className="flex-1 px-6 py-6">
            <textarea
              value={content}
              onChange={(e) => { setContent(e.target.value); setHasChanges(true) }}
              className="w-full h-full min-h-[calc(100vh-200px)] resize-none bg-transparent text-[14px] leading-[1.8] font-[family-name:var(--font-geist-mono)] outline-none placeholder:text-muted-foreground/20"
              placeholder="Start writing..."
            />
          </div>
        </div>

        {/* Properties sidebar */}
        <div className="w-56 border-l border-border p-5 space-y-5 overflow-auto">
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium">
              Project
            </label>
            <select
              value={projectId}
              onChange={(e) => { setProjectId(e.target.value); setHasChanges(true) }}
              className="w-full bg-transparent border border-border px-2.5 py-1.5 text-[12px] outline-none focus:border-foreground/30 transition-colors"
            >
              <option value="none">None</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-3 pt-2">
            <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium block">
              Options
            </label>
            <label className="flex items-center justify-between cursor-pointer group">
              <span className="text-[12px] text-muted-foreground group-hover:text-foreground transition-colors">Living Document</span>
              <button
                onClick={() => { setIsLiving(!isLiving); setHasChanges(true) }}
                className={`w-8 h-[18px] border transition-colors ${isLiving ? 'bg-foreground border-foreground' : 'border-border'}`}
              >
                <div className={`size-3 bg-background transition-transform ${isLiving ? 'translate-x-[14px]' : 'translate-x-0.5'}`} />
              </button>
            </label>
            <label className="flex items-center justify-between cursor-pointer group">
              <span className="text-[12px] text-muted-foreground group-hover:text-foreground transition-colors">Pinned</span>
              <button
                onClick={() => { setIsPinned(!isPinned); setHasChanges(true) }}
                className={`w-8 h-[18px] border transition-colors ${isPinned ? 'bg-foreground border-foreground' : 'border-border'}`}
              >
                <div className={`size-3 bg-background transition-transform ${isPinned ? 'translate-x-[14px]' : 'translate-x-0.5'}`} />
              </button>
            </label>
            <label className="flex items-center justify-between cursor-pointer group">
              <span className="text-[12px] text-muted-foreground group-hover:text-foreground transition-colors">Template</span>
              <button
                onClick={() => { setIsTemplate(!isTemplate); setHasChanges(true) }}
                className={`w-8 h-[18px] border transition-colors ${isTemplate ? 'bg-foreground border-foreground' : 'border-border'}`}
              >
                <div className={`size-3 bg-background transition-transform ${isTemplate ? 'translate-x-[14px]' : 'translate-x-0.5'}`} />
              </button>
            </label>
          </div>

          <div className="pt-4 border-t border-border space-y-1.5">
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground/40">Created</span>
              <span className="text-muted-foreground/60 tabular-nums">{new Date(doc?.created_at).toLocaleDateString()}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground/40">Updated</span>
              <span className="text-muted-foreground/60 tabular-nums">{new Date(doc?.updated_at).toLocaleDateString()}</span>
            </div>
          </div>
        </div>

        {/* Version History Panel */}
        {showHistory && (
          <div className="w-72 border-l border-border overflow-auto animate-in-fade">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium">Version History</span>
              <button onClick={() => setShowHistory(false)} className="p-0.5 text-muted-foreground/40 hover:text-foreground transition-colors">
                <X className="size-3" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              {versions.length === 0 ? (
                <p className="text-[12px] text-muted-foreground/40">No previous versions</p>
              ) : (
                versions.map(v => (
                  <div key={v.id} className="border border-border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-medium">v{v.version}</span>
                      <span className="text-[10px] text-muted-foreground/40 tabular-nums">
                        {new Date(v.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    {v.change_summary && (
                      <p className="text-[11px] text-muted-foreground/60 leading-relaxed">{v.change_summary}</p>
                    )}
                    <button
                      onClick={() => { setContent(v.content); setHasChanges(true) }}
                      className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Restore
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
