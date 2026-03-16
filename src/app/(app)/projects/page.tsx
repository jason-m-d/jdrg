'use client'

import { useState, useEffect } from 'react'
import { Plus, FileText, MessageSquare, Trash2, X } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

const COLORS = ['#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#EC4899', '#6B7280', '#06B6D4']

export default function ProjectsPage() {
  const [projects, setProjects] = useState<any[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#3B82F6')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadProjects() }, [])

  async function loadProjects() {
    const res = await fetch('/api/projects')
    const data = await res.json()
    setProjects(Array.isArray(data) ? data : [])
  }

  async function handleCreate() {
    if (!name.trim()) return
    setSaving(true)
    await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), description, color, system_prompt: systemPrompt }),
    })
    setSaving(false)
    setDialogOpen(false)
    setName(''); setDescription(''); setColor('#3B82F6'); setSystemPrompt('')
    loadProjects()
  }

  async function handleDelete(e: React.MouseEvent, projectId: string, projectName: string) {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm(`Delete "${projectName}"? Documents and conversations in this project won't be deleted, just unlinked.`)) return

    await fetch(`/api/projects/${projectId}`, { method: 'DELETE' })
    setProjects(prev => prev.filter(p => p.id !== projectId))
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 className="text-[13px] font-medium uppercase tracking-[0.1em]">Projects</h1>
        <button
          onClick={() => setDialogOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] bg-foreground text-background transition-opacity hover:opacity-80"
        >
          <Plus className="size-3" />
          New Project
        </button>
      </div>

      {/* Projects grid */}
      <div className="flex-1 overflow-auto p-6">
        {projects.length === 0 ? (
          <div className="text-center py-16 animate-in-fade">
            <div className="w-8 h-px bg-border mx-auto mb-4" />
            <p className="text-[13px] text-muted-foreground/60">No projects yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border border border-border">
            {projects.map(project => (
              <Link key={project.id} href={`/projects/${project.id}`}>
                <div className="bg-background p-5 hover:bg-muted/30 transition-colors cursor-pointer h-full group">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="size-3 shrink-0" style={{ backgroundColor: project.color || '#6B7280' }} />
                    <h3 className="text-[14px] font-medium flex-1 truncate">{project.name}</h3>
                    <button
                      className="p-1 opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-destructive transition-all"
                      onClick={(e) => handleDelete(e, project.id, project.name)}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                  {project.description && (
                    <p className="text-[12px] text-muted-foreground/60 mb-4 leading-relaxed line-clamp-2">{project.description}</p>
                  )}
                  <div className="flex gap-4 text-[11px] text-muted-foreground/40 tabular-nums">
                    <span className="flex items-center gap-1.5">
                      <FileText className="size-3" /> {project.document_count || 0}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <MessageSquare className="size-3" /> {project.conversation_count || 0}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Create dialog */}
      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-background/80" onClick={() => setDialogOpen(false)} />
          <div className="relative bg-background border border-border w-full max-w-md p-6 space-y-5 animate-in-up">
            <div className="flex items-center justify-between">
              <h2 className="text-[13px] font-medium uppercase tracking-[0.1em]">New Project</h2>
              <button onClick={() => setDialogOpen(false)} className="p-1 text-muted-foreground/40 hover:text-foreground transition-colors">
                <X className="size-3.5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium">Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Project name"
                  className="w-full bg-transparent border border-border px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground/30 focus:border-foreground/30 transition-colors"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium">Description</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description"
                  className="w-full bg-transparent border border-border px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground/30 focus:border-foreground/30 transition-colors"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium">Color</label>
                <div className="flex gap-2">
                  {COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className={cn(
                        "size-7 border-2 transition-colors",
                        color === c ? 'border-foreground' : 'border-transparent'
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium">
                  System Prompt <span className="normal-case tracking-normal text-muted-foreground/30">(optional)</span>
                </label>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="Custom instructions for AI..."
                  className="w-full bg-transparent border border-border px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground/30 focus:border-foreground/30 transition-colors min-h-[80px] resize-none"
                />
              </div>
              <button
                onClick={handleCreate}
                disabled={saving || !name.trim()}
                className="w-full bg-foreground text-background py-2.5 text-[13px] font-medium disabled:opacity-30 transition-opacity"
              >
                {saving ? 'Creating...' : 'Create Project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
