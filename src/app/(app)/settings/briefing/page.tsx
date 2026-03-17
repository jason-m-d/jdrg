'use client'

import { useState, useEffect } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { Plus, Trash2, Edit2, Save, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const STORE_NAMES: Record<string, string> = {
  '326': 'Coleman',
  '451': 'Hollenbeck',
  '895': 'McKee',
  '1870': 'Showers',
  '2067': 'Aborn',
  '2428': 'Winchester',
  '2262': 'Stevens Creek',
  '2289': 'Prospect',
  '405': 'Fresno (MP)',
  '1008': 'Van Nuys (MP)',
}

const QUICK_TOGGLES = [
  { label: 'Include sales data in briefings', memory: 'Include detailed sales data in morning briefings' },
  { label: 'Only alert for high-priority items', memory: 'Only send alerts for high-priority action items' },
]

export default function BriefingSettingsPage() {
  const [preferences, setPreferences] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [newContent, setNewContent] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => { loadPreferences() }, [])

  async function loadPreferences() {
    setLoading(true)
    const { data } = await getSupabaseBrowser()
      .from('memories')
      .select('*')
      .eq('category', 'preference')
      .order('created_at', { ascending: false })
    setPreferences(data || [])
    setLoading(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Remove this preference?')) return
    await getSupabaseBrowser().from('memories').delete().eq('id', id)
    setPreferences(prev => prev.filter(m => m.id !== id))
  }

  async function handleSaveEdit(id: string) {
    await getSupabaseBrowser().from('memories').update({
      content: editContent,
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    setPreferences(prev => prev.map(m => m.id === id ? { ...m, content: editContent } : m))
    setEditingId(null)
  }

  async function handleAdd() {
    if (!newContent.trim()) return
    setAdding(true)
    const { data } = await getSupabaseBrowser()
      .from('memories')
      .insert({ content: newContent.trim(), category: 'preference' })
      .select()
      .single()
    if (data) setPreferences(prev => [data, ...prev])
    setNewContent('')
    setAdding(false)
  }

  async function handleToggle(memory: string, enabled: boolean) {
    if (enabled) {
      // Create the preference memory
      const { data } = await getSupabaseBrowser()
        .from('memories')
        .insert({ content: memory, category: 'preference' })
        .select()
        .single()
      if (data) setPreferences(prev => [data, ...prev])
    } else {
      // Delete matching preference
      const match = preferences.find(p => p.content === memory)
      if (match) {
        await getSupabaseBrowser().from('memories').delete().eq('id', match.id)
        setPreferences(prev => prev.filter(m => m.id !== match.id))
      }
    }
  }

  async function handleStoreToggle(storeNumber: string, storeName: string, enabled: boolean) {
    const memory = `Include ${storeName} (store ${storeNumber}) in alert notifications`
    if (enabled) {
      const { data } = await getSupabaseBrowser()
        .from('memories')
        .insert({ content: memory, category: 'preference' })
        .select()
        .single()
      if (data) setPreferences(prev => [data, ...prev])
    } else {
      const match = preferences.find(p => p.content.includes(`store ${storeNumber}`) && p.content.includes('alert'))
      if (match) {
        await getSupabaseBrowser().from('memories').delete().eq('id', match.id)
        setPreferences(prev => prev.filter(m => m.id !== match.id))
      }
    }
  }

  function isToggleOn(memory: string) {
    return preferences.some(p => p.content === memory)
  }

  function isStoreOn(storeNumber: string) {
    return preferences.some(p => p.content.includes(`store ${storeNumber}`) && p.content.includes('alert'))
  }

  return (
    <div className="max-w-2xl space-y-8 animate-in-fade">
      <div>
        <h1 className="text-[13px] font-medium uppercase tracking-[0.1em] mb-1">Briefing & Alerts</h1>
        <p className="text-[12px] text-muted-foreground/50">
          Teach J.DRG what matters. These preferences shape your morning briefing and real-time alerts.
        </p>
      </div>

      {/* Quick toggles */}
      <div className="space-y-3">
        <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium">
          Quick Settings
        </span>
        <div className="border border-border divide-y divide-border">
          {QUICK_TOGGLES.map(toggle => (
            <label key={toggle.memory} className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors">
              <span className="text-[13px]">{toggle.label}</span>
              <button
                onClick={() => handleToggle(toggle.memory, !isToggleOn(toggle.memory))}
                className={cn(
                  'relative w-9 h-5 rounded-full transition-colors',
                  isToggleOn(toggle.memory) ? 'bg-foreground' : 'bg-muted-foreground/20'
                )}
              >
                <span className={cn(
                  'absolute top-0.5 left-0.5 size-4 rounded-full bg-background transition-transform',
                  isToggleOn(toggle.memory) && 'translate-x-4'
                )} />
              </button>
            </label>
          ))}
        </div>
      </div>

      {/* Per-store toggles */}
      <div className="space-y-3">
        <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium">
          Store Alerts
        </span>
        <div className="border border-border divide-y divide-border">
          {Object.entries(STORE_NAMES).map(([num, name]) => (
            <label key={num} className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-muted/30 transition-colors">
              <span className="text-[13px]">
                <span className="text-muted-foreground/60 text-[11px] tabular-nums mr-2">#{num}</span>
                {name}
              </span>
              <button
                onClick={() => handleStoreToggle(num, name, !isStoreOn(num))}
                className={cn(
                  'relative w-9 h-5 rounded-full transition-colors',
                  isStoreOn(num) ? 'bg-foreground' : 'bg-muted-foreground/20'
                )}
              >
                <span className={cn(
                  'absolute top-0.5 left-0.5 size-4 rounded-full bg-background transition-transform',
                  isStoreOn(num) && 'translate-x-4'
                )} />
              </button>
            </label>
          ))}
        </div>
      </div>

      {/* Add custom preference */}
      <div className="space-y-3">
        <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium">
          Custom Preferences
        </span>
        <div className="border border-border p-4 space-y-3">
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="e.g. Don't include labor data in briefings"
            className="w-full bg-transparent border border-border px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground/30 focus:border-foreground/30 transition-colors min-h-[50px] resize-none"
          />
          <button
            onClick={handleAdd}
            disabled={adding || !newContent.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] bg-foreground text-background disabled:opacity-30 transition-opacity"
          >
            <Plus className="size-3" /> Add Preference
          </button>
        </div>
      </div>

      {/* All preferences list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-4 animate-spin text-muted-foreground/40" />
        </div>
      ) : preferences.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-8 h-px bg-border mx-auto mb-4" />
          <p className="text-[13px] text-muted-foreground/60">No preferences set yet. Use the toggles above or add custom ones.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium">
            All Preferences ({preferences.length})
          </span>
          <div className="divide-y divide-border border border-border">
            {preferences.map(pref => (
              <div key={pref.id} className="p-4">
                {editingId === pref.id ? (
                  <div className="flex items-start gap-2">
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="flex-1 bg-transparent border border-border px-3 py-2 text-[13px] outline-none focus:border-foreground/30 transition-colors min-h-[40px] resize-none"
                    />
                    <button onClick={() => handleSaveEdit(pref.id)} className="p-1.5 text-muted-foreground hover:text-foreground transition-colors">
                      <Save className="size-3.5" />
                    </button>
                    <button onClick={() => setEditingId(null)} className="p-1.5 text-muted-foreground/40 hover:text-foreground transition-colors">
                      <X className="size-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <p className="flex-1 text-[13px] leading-relaxed">{pref.content}</p>
                    <div className="flex gap-0.5 shrink-0">
                      <button
                        onClick={() => { setEditingId(pref.id); setEditContent(pref.content) }}
                        className="p-1.5 text-muted-foreground/30 hover:text-foreground transition-colors"
                      >
                        <Edit2 className="size-3" />
                      </button>
                      <button
                        onClick={() => handleDelete(pref.id)}
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
        </div>
      )}
    </div>
  )
}
