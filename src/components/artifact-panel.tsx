'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { X, Pencil, Eye, History, ChevronDown, RotateCcw, FolderOpen, Loader2, Check } from 'lucide-react'
import { FormattedContent } from '@/components/chat-messages'
import type { Artifact, ArtifactVersion } from '@/lib/types'

interface ArtifactPanelProps {
  artifacts: Artifact[]
  activeArtifactId: string | null
  onSelectArtifact: (id: string) => void
  onCloseArtifact: (id: string) => void
  onClosePanel: () => void
  onArtifactUpdated: (artifact: Artifact) => void
  projectId?: string | null
  projects?: { id: string; name: string; color: string | null }[]
}

export function ArtifactPanel({
  artifacts,
  activeArtifactId,
  onSelectArtifact,
  onCloseArtifact,
  onClosePanel,
  onArtifactUpdated,
  projectId,
  projects,
}: ArtifactPanelProps) {
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [editContent, setEditContent] = useState('')
  const [editName, setEditName] = useState('')
  const [showVersions, setShowVersions] = useState(false)
  const [versions, setVersions] = useState<ArtifactVersion[]>([])
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [showProjectPicker, setShowProjectPicker] = useState(false)
  const [savingProject, setSavingProject] = useState(false)
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null)

  const active = artifacts.find(a => a.id === activeArtifactId)

  // Sync edit state when active artifact changes
  useEffect(() => {
    if (active) {
      setEditContent(active.content)
      setEditName(active.name)
      setMode('view')
      setShowVersions(false)
    }
  }, [activeArtifactId])

  // Update edit content when artifact content changes externally (e.g., AI update)
  useEffect(() => {
    if (active && mode === 'view') {
      setEditContent(active.content)
      setEditName(active.name)
    }
  }, [active?.content, active?.name])

  // Debounced auto-save
  const debouncedSave = useCallback((artifactId: string, content: string, name: string) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      const res = await fetch(`/api/artifacts/${artifactId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, name, changed_by: 'user' }),
      })
      if (res.ok) {
        const updated = await res.json()
        onArtifactUpdated(updated)
      }
    }, 2000)
  }, [onArtifactUpdated])

  function handleContentChange(newContent: string) {
    setEditContent(newContent)
    if (active) debouncedSave(active.id, newContent, editName)
  }

  function handleNameChange(newName: string) {
    setEditName(newName)
    if (active) debouncedSave(active.id, editContent, newName)
  }

  async function loadVersions() {
    if (!active) return
    setShowVersions(true)
    setLoadingVersions(true)
    const res = await fetch(`/api/artifacts/${active.id}/versions`)
    const data = await res.json()
    setVersions(data)
    setLoadingVersions(false)
  }

  async function restoreVersion(version: number) {
    if (!active) return
    const res = await fetch(`/api/artifacts/${active.id}/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restore_version: version }),
    })
    if (res.ok) {
      const updated = await res.json()
      onArtifactUpdated(updated)
      setEditContent(updated.content)
      setShowVersions(false)
    }
  }

  async function saveToProject(targetProjectId: string) {
    if (!active) return
    setSavingProject(true)
    const res = await fetch(`/api/artifacts/${active.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: targetProjectId }),
    })
    if (res.ok) {
      const updated = await res.json()
      onArtifactUpdated(updated)
    }
    setSavingProject(false)
    setShowProjectPicker(false)
  }

  if (artifacts.length === 0) return null

  const TYPE_COLORS: Record<string, string> = {
    plan: 'text-blue-500',
    spec: 'text-violet-500',
    checklist: 'text-emerald-500',
    freeform: 'text-muted-foreground/50',
  }

  return (
    <div className="w-96 border-l border-border flex flex-col shrink-0 bg-background animate-in-fade">
      {/* Tab bar */}
      <div className="flex items-center border-b border-border overflow-x-auto">
        <div className="flex items-center flex-1 min-w-0">
          {artifacts.map(a => (
            <button
              key={a.id}
              onClick={() => onSelectArtifact(a.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2.5 text-[11px] border-b-2 transition-colors shrink-0 max-w-[160px] group",
                a.id === activeArtifactId
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground/50 hover:text-muted-foreground'
              )}
            >
              <span className="truncate">{a.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); onCloseArtifact(a.id) }}
                className="p-0.5 opacity-0 group-hover:opacity-100 hover:text-foreground transition-opacity shrink-0"
              >
                <X className="size-2.5" />
              </button>
            </button>
          ))}
        </div>
        <button
          onClick={onClosePanel}
          className="p-2 text-muted-foreground/40 hover:text-foreground transition-colors shrink-0"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* Active artifact content */}
      {active && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Toolbar */}
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border">
            <span className={cn("text-[10px] uppercase tracking-wider font-medium", TYPE_COLORS[active.type] || TYPE_COLORS.freeform)}>
              {active.type}
            </span>
            {active.project_id && (
              <span className="text-[10px] text-emerald-500/70 flex items-center gap-0.5">
                <FolderOpen className="size-2.5" /> saved
              </span>
            )}
            <div className="flex-1" />
            <span className="text-[10px] text-muted-foreground/30 tabular-nums">v{active.version}</span>
            <button
              onClick={() => setMode(mode === 'edit' ? 'view' : 'edit')}
              className={cn(
                "p-1 transition-colors",
                mode === 'edit' ? 'text-foreground' : 'text-muted-foreground/40 hover:text-foreground'
              )}
              title={mode === 'edit' ? 'Preview' : 'Edit'}
            >
              {mode === 'edit' ? <Eye className="size-3" /> : <Pencil className="size-3" />}
            </button>
            <button
              onClick={() => showVersions ? setShowVersions(false) : loadVersions()}
              className={cn(
                "p-1 transition-colors",
                showVersions ? 'text-foreground' : 'text-muted-foreground/40 hover:text-foreground'
              )}
              title="Version history"
            >
              <History className="size-3" />
            </button>
            {projects && projects.length > 0 && !active.project_id && (
              <div className="relative">
                <button
                  onClick={() => setShowProjectPicker(!showProjectPicker)}
                  className="p-1 text-muted-foreground/40 hover:text-foreground transition-colors"
                  title="Save to project"
                >
                  <FolderOpen className="size-3" />
                </button>
                {showProjectPicker && (
                  <div className="absolute right-0 top-full mt-1 w-48 bg-background border border-border z-10 shadow-lg">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground/40 px-3 py-2 border-b border-border">
                      Save to project
                    </div>
                    {projects.map(p => (
                      <button
                        key={p.id}
                        onClick={() => saveToProject(p.id)}
                        disabled={savingProject}
                        className="w-full flex items-center gap-2 px-3 py-2 text-[11px] hover:bg-muted/30 transition-colors text-left"
                      >
                        <div className="size-2 shrink-0" style={{ backgroundColor: p.color || '#6B7280' }} />
                        <span className="truncate">{p.name}</span>
                        {savingProject && <Loader2 className="size-2.5 animate-spin ml-auto" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {active.project_id && projectId && active.project_id === projectId && (
              <span className="flex items-center gap-0.5 text-[10px] text-emerald-500">
                <Check className="size-2.5" />
              </span>
            )}
          </div>

          {/* Version history dropdown */}
          {showVersions && (
            <div className="border-b border-border max-h-48 overflow-auto">
              {loadingVersions ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="size-3 animate-spin text-muted-foreground/40" />
                </div>
              ) : versions.length === 0 ? (
                <p className="text-[11px] text-muted-foreground/40 py-4 text-center">No previous versions</p>
              ) : (
                <div>
                  {versions.map(v => (
                    <div key={v.id} className="flex items-center gap-2 px-3 py-2 text-[11px] border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <span className="text-muted-foreground/50 tabular-nums shrink-0">v{v.version}</span>
                      <span className="text-muted-foreground/40 text-[10px] shrink-0">{v.changed_by}</span>
                      <span className="text-muted-foreground/40 truncate flex-1">
                        {v.change_summary || v.content.slice(0, 60) + '...'}
                      </span>
                      <button
                        onClick={() => restoreVersion(v.version)}
                        className="p-0.5 text-muted-foreground/40 hover:text-foreground transition-colors shrink-0"
                        title="Restore this version"
                      >
                        <RotateCcw className="size-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Name editing */}
          {mode === 'edit' ? (
            <div className="px-3 pt-3 pb-1">
              <input
                value={editName}
                onChange={(e) => handleNameChange(e.target.value)}
                className="w-full bg-transparent text-[14px] font-semibold outline-none border-b border-border/50 pb-1 focus:border-foreground/30 transition-colors"
                placeholder="Artifact name"
              />
            </div>
          ) : (
            <div className="px-3 pt-3 pb-1">
              <h3 className="text-[14px] font-semibold">{active.name}</h3>
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-auto min-h-0">
            {mode === 'edit' ? (
              <textarea
                value={editContent}
                onChange={(e) => handleContentChange(e.target.value)}
                className="w-full h-full bg-transparent px-3 py-2 text-[13px] leading-relaxed outline-none resize-none font-[family-name:var(--font-geist-mono)]"
                placeholder="Write markdown content..."
              />
            ) : (
              <div className="px-3 py-2 text-[13px] leading-[1.7] text-foreground/85">
                <FormattedContent content={active.content} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
