'use client'

import { useState, useEffect } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { Check, X, Archive, Clock, Mail, MessageSquare, Loader2, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'

const TABS = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'completed', label: 'Completed' },
  { value: 'dismissed', label: 'Dismissed' },
]

const PRIORITIES = ['high', 'medium', 'low'] as const

export default function ActionItemsPage() {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('pending')

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editPriority, setEditPriority] = useState<string>('medium')
  const [editDueDate, setEditDueDate] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadItems() }, [tab])

  async function loadItems() {
    setLoading(true)
    setEditingId(null)
    const { data } = await getSupabaseBrowser()
      .from('action_items')
      .select('*')
      .eq('status', tab)
      .order('priority')
      .order('created_at', { ascending: false })
    setItems(data || [])
    setLoading(false)
  }

  async function updateStatus(id: string, status: string) {
    await getSupabaseBrowser().from('action_items').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    setItems(prev => prev.filter(i => i.id !== id))
  }

  async function bulkAction(status: string) {
    const ids = items.map(i => i.id)
    if (ids.length === 0) return
    await getSupabaseBrowser().from('action_items').update({ status, updated_at: new Date().toISOString() }).in('id', ids)
    loadItems()
  }

  function startEdit(item: any) {
    setEditingId(item.id)
    setEditTitle(item.title)
    setEditDescription(item.description || '')
    setEditPriority(item.priority || 'medium')
    setEditDueDate(item.due_date || '')
  }

  function cancelEdit() {
    setEditingId(null)
  }

  async function saveEdit(id: string) {
    if (!editTitle.trim()) return
    setSaving(true)
    await getSupabaseBrowser()
      .from('action_items')
      .update({
        title: editTitle.trim(),
        description: editDescription.trim() || null,
        priority: editPriority,
        due_date: editDueDate || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    setItems(prev => prev.map(i => i.id === id ? {
      ...i,
      title: editTitle.trim(),
      description: editDescription.trim() || null,
      priority: editPriority,
      due_date: editDueDate || null,
    } : i))
    setEditingId(null)
    setSaving(false)
  }

  async function deleteItem(id: string) {
    if (!confirm('Delete this action item permanently?')) return
    await getSupabaseBrowser().from('action_items').delete().eq('id', id)
    setItems(prev => prev.filter(i => i.id !== id))
  }

  const priorityIndicator: Record<string, string> = {
    high: 'bg-red-500',
    medium: 'bg-yellow-500',
    low: 'bg-muted-foreground/40',
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-[13px] font-medium uppercase tracking-[0.1em]">Action Items</h1>
          {tab === 'pending' && items.length > 0 && (
            <div className="flex gap-2">
              <button
                onClick={() => bulkAction('approved')}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
              >
                <Check className="size-3" /> Approve All
              </button>
              <button
                onClick={() => bulkAction('dismissed')}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
              >
                <X className="size-3" /> Dismiss All
              </button>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-transparent -mb-px">
          {TABS.map(t => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={cn(
                "px-4 py-2 text-[12px] transition-colors border-b-2",
                tab === t.value
                  ? "text-foreground border-foreground font-medium"
                  : "text-muted-foreground/50 border-transparent hover:text-muted-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="size-4 animate-spin text-muted-foreground/40" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16 animate-in-fade">
            <div className="w-8 h-px bg-border mx-auto mb-4" />
            <p className="text-[13px] text-muted-foreground/60">No {tab} items</p>
          </div>
        ) : (
          <div className="space-y-px">
            {items.map(item => (
              <div key={item.id} className="border border-border p-4 animate-in-fade">
                {editingId === item.id ? (
                  /* Edit mode */
                  <div className="space-y-3">
                    <input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full bg-transparent border border-border px-3 py-2 text-[14px] font-medium outline-none focus:border-foreground/30 transition-colors"
                      placeholder="Title"
                      autoFocus
                    />
                    <textarea
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      className="w-full bg-transparent border border-border px-3 py-2 text-[12px] outline-none focus:border-foreground/30 transition-colors min-h-[60px] resize-none leading-relaxed"
                      placeholder="Description (optional)"
                    />
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium">Priority</span>
                        <div className="flex gap-1">
                          {PRIORITIES.map(p => (
                            <button
                              key={p}
                              onClick={() => setEditPriority(p)}
                              className={cn(
                                "px-2 py-0.5 text-[11px] border transition-colors capitalize",
                                editPriority === p
                                  ? 'border-foreground/30 text-foreground'
                                  : 'border-border text-muted-foreground/40 hover:text-muted-foreground'
                              )}
                            >
                              {p}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium">Due</span>
                        <input
                          type="date"
                          value={editDueDate}
                          onChange={(e) => setEditDueDate(e.target.value)}
                          className="bg-transparent border border-border px-2 py-0.5 text-[11px] outline-none focus:border-foreground/30 transition-colors text-muted-foreground"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => saveEdit(item.id)}
                        disabled={saving || !editTitle.trim()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] bg-foreground text-background transition-opacity hover:opacity-80 disabled:opacity-30"
                      >
                        {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                        Save
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] border border-border text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => deleteItem(item.id)}
                        className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-muted-foreground/40 hover:text-destructive transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ) : (
                  /* View mode */
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      {/* Meta row */}
                      <div className="flex items-center gap-3 mb-1.5">
                        <div className={cn('size-1.5', priorityIndicator[item.priority])} />
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/40">{item.priority}</span>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/30 flex items-center gap-1">
                          {item.source === 'email' ? <Mail className="size-2.5" /> : <MessageSquare className="size-2.5" />}
                          {item.source}
                        </span>
                        {item.due_date && (
                          <span className="text-[10px] text-muted-foreground/30 flex items-center gap-1 tabular-nums">
                            <Clock className="size-2.5" /> {item.due_date}
                          </span>
                        )}
                      </div>

                      {/* Title + description */}
                      <h3 className="text-[14px] font-medium leading-snug">{item.title}</h3>
                      {item.description && (
                        <p className="text-[12px] text-muted-foreground/60 mt-1 leading-relaxed">{item.description}</p>
                      )}
                      {item.source_snippet && (
                        <p className="text-[11px] text-muted-foreground/40 mt-2 italic border-l-2 border-border pl-3 leading-relaxed">
                          {item.source_snippet}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => startEdit(item)}
                        className="p-1.5 border border-border text-muted-foreground/40 hover:text-foreground hover:border-foreground/30 transition-colors"
                        title="Edit"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      {tab === 'pending' && (
                        <>
                          <button
                            onClick={() => updateStatus(item.id, 'approved')}
                            className="p-1.5 border border-border text-muted-foreground/40 hover:text-green-600 hover:border-green-600/30 transition-colors"
                            title="Approve"
                          >
                            <Check className="size-3.5" />
                          </button>
                          <button
                            onClick={() => updateStatus(item.id, 'dismissed')}
                            className="p-1.5 border border-border text-muted-foreground/40 hover:text-red-600 hover:border-red-600/30 transition-colors"
                            title="Dismiss"
                          >
                            <X className="size-3.5" />
                          </button>
                        </>
                      )}
                      {tab === 'approved' && (
                        <button
                          onClick={() => updateStatus(item.id, 'completed')}
                          className="p-1.5 border border-border text-muted-foreground/40 hover:text-green-600 hover:border-green-600/30 transition-colors"
                          title="Complete"
                        >
                          <Check className="size-3.5" />
                        </button>
                      )}
                      {(tab === 'completed' || tab === 'dismissed') && (
                        <button
                          onClick={() => updateStatus(item.id, 'pending')}
                          className="p-1.5 border border-border text-muted-foreground/40 hover:text-foreground hover:border-foreground/30 transition-colors"
                          title="Reopen"
                        >
                          <Archive className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
