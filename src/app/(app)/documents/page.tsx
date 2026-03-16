'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Upload, Grid, List, FileText, File, Table, Loader2, Search } from 'lucide-react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import Link from 'next/link'
import { cn } from '@/lib/utils'

function timeAgo(date: string) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'grid' | 'list'>('list')
  const [search, setSearch] = useState('')
  const [filterProject, setFilterProject] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [projects, setProjects] = useState<any[]>([])
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const router = useRouter()

  useEffect(() => {
    loadDocuments()
    getSupabaseBrowser().from('projects').select('id, name, color').order('name')
      .then(({ data }) => setProjects(data || []))
  }, [filterProject, filterType])

  async function loadDocuments() {
    setLoading(true)
    let url = '/api/documents?'
    if (filterProject && filterProject !== 'all') url += `project_id=${filterProject}&`
    if (filterType && filterType !== 'all') url += `file_type=${filterType}&`

    const res = await fetch(url)
    const data = await res.json()
    setDocuments(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)

    for (const file of Array.from(files)) {
      const formData = new FormData()
      formData.append('file', file)
      if (filterProject && filterProject !== 'all') formData.append('project_id', filterProject)

      await fetch('/api/documents/upload', { method: 'POST', body: formData })
    }

    setUploading(false)
    loadDocuments()
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    handleUpload(e.dataTransfer.files)
  }

  const filtered = documents.filter(d =>
    !search || d.title.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div
      className="h-full flex flex-col"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="border-b border-border px-6 py-4 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-[13px] font-medium uppercase tracking-[0.1em]">Documents</h1>
          <div className="flex items-center gap-2">
            <label>
              <input
                type="file"
                className="hidden"
                multiple
                accept=".pdf,.docx,.xlsx,.xls,.txt,.md"
                onChange={(e) => handleUpload(e.target.files)}
              />
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors cursor-pointer">
                {uploading ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />}
                Upload
              </span>
            </label>
            <button
              onClick={() => router.push('/documents/new')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] bg-foreground text-background transition-opacity hover:opacity-80"
            >
              <Plus className="size-3" />
              Create
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/40" />
            <input
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-transparent border border-border pl-8 pr-3 py-1.5 text-[13px] outline-none placeholder:text-muted-foreground/30 focus:border-foreground/30 transition-colors"
            />
          </div>
          <select
            value={filterProject}
            onChange={(e) => setFilterProject(e.target.value)}
            className="bg-transparent border border-border px-2.5 py-1.5 text-[12px] text-muted-foreground outline-none focus:border-foreground/30 transition-colors"
          >
            <option value="all">All projects</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="bg-transparent border border-border px-2.5 py-1.5 text-[12px] text-muted-foreground outline-none focus:border-foreground/30 transition-colors"
          >
            <option value="all">All types</option>
            <option value="pdf">PDF</option>
            <option value="docx">DOCX</option>
            <option value="xlsx">Excel</option>
            <option value="text">Text</option>
            <option value="created">Created</option>
          </select>
          <div className="flex border border-border">
            <button
              onClick={() => setView('grid')}
              className={cn(
                "p-1.5 transition-colors",
                view === 'grid' ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Grid className="size-3.5" />
            </button>
            <button
              onClick={() => setView('list')}
              className={cn(
                "p-1.5 transition-colors",
                view === 'list' ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <List className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Drop overlay */}
      {dragOver && (
        <div className="absolute inset-0 z-50 bg-foreground/5 border-2 border-dashed border-foreground/20 flex items-center justify-center">
          <div className="text-center">
            <Upload className="size-5 mx-auto mb-2 text-muted-foreground" />
            <p className="text-[13px] text-muted-foreground">Drop files to upload</p>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="size-4 animate-spin text-muted-foreground/40" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 animate-in-fade">
            <div className="w-8 h-px bg-border mx-auto mb-4" />
            <p className="text-[13px] text-muted-foreground/60">No documents yet</p>
            <p className="text-[11px] text-muted-foreground/40 mt-1">Upload a file or create a new document</p>
          </div>
        ) : view === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-px bg-border">
            {filtered.map(doc => (
              <Link key={doc.id} href={`/documents/${doc.id}`}>
                <div className="bg-background p-4 hover:bg-muted/30 transition-colors cursor-pointer h-full">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <h3 className="text-[13px] font-medium line-clamp-2 leading-snug">{doc.title}</h3>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-2">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50">{doc.file_type}</span>
                    {doc.is_living && <span className="text-[10px] uppercase tracking-wider text-green-600">Live</span>}
                    {doc.is_pinned && <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50">Pinned</span>}
                    {doc.is_template && <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50">Template</span>}
                  </div>
                  {doc.projects && (
                    <div className="flex items-center gap-1.5 mb-2">
                      <div className="size-1.5" style={{ backgroundColor: doc.projects.color }} />
                      <span className="text-[11px] text-muted-foreground/50">{doc.projects.name}</span>
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground/40 tabular-nums">{timeAgo(doc.updated_at)}</p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-border border border-border">
            {filtered.map(doc => (
              <Link key={doc.id} href={`/documents/${doc.id}`}>
                <div className="flex items-center gap-4 px-4 py-3 hover:bg-muted/30 transition-colors">
                  <FileText className="size-3.5 text-muted-foreground/40 shrink-0" />
                  <span className="flex-1 text-[13px] font-medium truncate">{doc.title}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/40">{doc.file_type}</span>
                    {doc.is_living && <span className="text-[10px] uppercase tracking-wider text-green-600">Live</span>}
                  </div>
                  {doc.projects && (
                    <div className="flex items-center gap-1.5">
                      <div className="size-1.5" style={{ backgroundColor: doc.projects.color }} />
                      <span className="text-[11px] text-muted-foreground/40">{doc.projects.name}</span>
                    </div>
                  )}
                  <span className="text-[11px] text-muted-foreground/30 tabular-nums w-14 text-right">{timeAgo(doc.updated_at)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
