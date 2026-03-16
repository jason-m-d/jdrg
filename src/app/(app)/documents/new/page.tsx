'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { Loader2, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function NewDocumentPage() {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [projectId, setProjectId] = useState('none')
  const [isLiving, setIsLiving] = useState(false)
  const [isPinned, setIsPinned] = useState(false)
  const [isTemplate, setIsTemplate] = useState(false)
  const [projects, setProjects] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  useEffect(() => {
    getSupabaseBrowser().from('projects').select('id, name, color').order('name')
      .then(({ data }) => setProjects(data || []))
  }, [])

  async function handleSave() {
    if (!title.trim()) return
    setSaving(true)

    const res = await fetch('/api/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title.trim(),
        content,
        file_type: 'created',
        project_id: projectId === 'none' ? null : projectId,
        is_living: isLiving,
        is_pinned: isPinned,
        is_template: isTemplate,
      }),
    })

    const doc = await res.json()
    router.push(`/documents/${doc.id}`)
  }

  return (
    <div className="h-full flex flex-col animate-in-fade">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-6 py-3">
        <Link href="/documents" className="p-1 text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="size-4" />
        </Link>
        <span className="text-[13px] font-medium uppercase tracking-[0.1em] flex-1">New Document</span>
        <button
          onClick={handleSave}
          disabled={saving || !title.trim()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] bg-foreground text-background disabled:opacity-30 transition-opacity"
        >
          {saving && <Loader2 className="size-3 animate-spin" />}
          Create
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Editor */}
        <div className="flex-1 flex flex-col">
          <div className="px-6 pt-6 pb-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Untitled"
              className="w-full bg-transparent text-[20px] font-medium tracking-tight outline-none placeholder:text-muted-foreground/20"
            />
          </div>
          <div className="flex-1 px-6 pb-6">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Start writing..."
              className="w-full h-full resize-none bg-transparent text-[14px] leading-[1.8] font-[family-name:var(--font-geist-mono)] outline-none placeholder:text-muted-foreground/20"
            />
          </div>
        </div>

        {/* Properties sidebar */}
        <div className="w-56 border-l border-border p-5 space-y-5">
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium">
              Project
            </label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
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
                onClick={() => setIsLiving(!isLiving)}
                className={`w-8 h-[18px] border transition-colors ${isLiving ? 'bg-foreground border-foreground' : 'border-border'}`}
              >
                <div className={`size-3 bg-background transition-transform ${isLiving ? 'translate-x-[14px]' : 'translate-x-0.5'}`} />
              </button>
            </label>
            <label className="flex items-center justify-between cursor-pointer group">
              <span className="text-[12px] text-muted-foreground group-hover:text-foreground transition-colors">Pinned</span>
              <button
                onClick={() => setIsPinned(!isPinned)}
                className={`w-8 h-[18px] border transition-colors ${isPinned ? 'bg-foreground border-foreground' : 'border-border'}`}
              >
                <div className={`size-3 bg-background transition-transform ${isPinned ? 'translate-x-[14px]' : 'translate-x-0.5'}`} />
              </button>
            </label>
            <label className="flex items-center justify-between cursor-pointer group">
              <span className="text-[12px] text-muted-foreground group-hover:text-foreground transition-colors">Template</span>
              <button
                onClick={() => setIsTemplate(!isTemplate)}
                className={`w-8 h-[18px] border transition-colors ${isTemplate ? 'bg-foreground border-foreground' : 'border-border'}`}
              >
                <div className={`size-3 bg-background transition-transform ${isTemplate ? 'translate-x-[14px]' : 'translate-x-0.5'}`} />
              </button>
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}
