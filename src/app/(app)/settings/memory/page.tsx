'use client'

import { useState, useEffect } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { Plus, Trash2, Edit2, Save, X, Search, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function MemoryPage() {
  const [memories, setMemories] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [newContent, setNewContent] = useState('')
  const [newCategory, setNewCategory] = useState('fact')
  const [adding, setAdding] = useState(false)

  useEffect(() => { loadMemories() }, [])

  async function loadMemories() {
    setLoading(true)
    const { data } = await getSupabaseBrowser()
      .from('memories')
      .select('*')
      .order('created_at', { ascending: false })
    setMemories(data || [])
    setLoading(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this memory?')) return
    await getSupabaseBrowser().from('memories').delete().eq('id', id)
    setMemories(prev => prev.filter(m => m.id !== id))
  }

  async function handleSaveEdit(id: string) {
    await getSupabaseBrowser().from('memories').update({ content: editContent, category: editCategory, updated_at: new Date().toISOString() }).eq('id', id)
    setMemories(prev => prev.map(m => m.id === id ? { ...m, content: editContent, category: editCategory } : m))
    setEditingId(null)
  }

  async function handleAdd() {
    if (!newContent.trim()) return
    setAdding(true)
    const { data } = await getSupabaseBrowser().from('memories').insert({ content: newContent.trim(), category: newCategory }).select().single()
    if (data) setMemories(prev => [data, ...prev])
    setNewContent('')
    setAdding(false)
  }

  const filtered = memories.filter(m =>
    !search || m.content.toLowerCase().includes(search.toLowerCase()) || m.category?.toLowerCase().includes(search.toLowerCase())
  )

  const categoryIndicator: Record<string, string> = {
    fact: 'bg-blue-500',
    preference: 'bg-purple-500',
    context: 'bg-green-500',
  }

  return (
    <div className="max-w-2xl space-y-6 animate-in-fade">
      <div>
        <h1 className="text-[13px] font-medium uppercase tracking-[0.1em] mb-1">Memory</h1>
        <p className="text-[12px] text-muted-foreground/50">J.DRG remembers these facts across all conversations.</p>
      </div>

      {/* Add new memory */}
      <div className="border border-border p-4 space-y-3">
        <textarea
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          placeholder="Add a new memory..."
          className="w-full bg-transparent border border-border px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground/30 focus:border-foreground/30 transition-colors min-h-[60px] resize-none"
        />
        <div className="flex items-center gap-2">
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            className="bg-transparent border border-border px-2.5 py-1.5 text-[12px] text-muted-foreground outline-none focus:border-foreground/30 transition-colors"
          >
            <option value="fact">Fact</option>
            <option value="preference">Preference</option>
            <option value="context">Context</option>
          </select>
          <button
            onClick={handleAdd}
            disabled={adding || !newContent.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] bg-foreground text-background disabled:opacity-30 transition-opacity"
          >
            <Plus className="size-3" /> Add
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/40" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          className="w-full bg-transparent border border-border pl-8 pr-3 py-1.5 text-[13px] outline-none placeholder:text-muted-foreground/30 focus:border-foreground/30 transition-colors"
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-4 animate-spin text-muted-foreground/40" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-8 h-px bg-border mx-auto mb-4" />
          <p className="text-[13px] text-muted-foreground/60">No memories found</p>
        </div>
      ) : (
        <div className="divide-y divide-border border border-border">
          {filtered.map(memory => (
            <div key={memory.id} className="p-4">
              {editingId === memory.id ? (
                <div className="space-y-3">
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full bg-transparent border border-border px-3 py-2 text-[13px] outline-none focus:border-foreground/30 transition-colors min-h-[60px] resize-none"
                  />
                  <div className="flex items-center gap-2">
                    <select
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
                      className="bg-transparent border border-border px-2.5 py-1.5 text-[12px] text-muted-foreground outline-none"
                    >
                      <option value="fact">Fact</option>
                      <option value="preference">Preference</option>
                      <option value="context">Context</option>
                    </select>
                    <button
                      onClick={() => handleSaveEdit(memory.id)}
                      className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Save className="size-3.5" />
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="p-1.5 text-muted-foreground/40 hover:text-foreground transition-colors"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className={cn('size-1.5', categoryIndicator[memory.category] || 'bg-muted-foreground/40')} />
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/40">
                        {memory.category || 'general'}
                      </span>
                    </div>
                    <p className="text-[13px] leading-relaxed">{memory.content}</p>
                  </div>
                  <div className="flex gap-0.5 shrink-0">
                    <button
                      onClick={() => { setEditingId(memory.id); setEditContent(memory.content); setEditCategory(memory.category || 'fact') }}
                      className="p-1.5 text-muted-foreground/30 hover:text-foreground transition-colors"
                    >
                      <Edit2 className="size-3" />
                    </button>
                    <button
                      onClick={() => handleDelete(memory.id)}
                      className="p-1.5 text-muted-foreground/30 hover:text-destructive transition-colors"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
