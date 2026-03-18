'use client'

import { useState, useEffect } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { Calendar, RefreshCw, Plus, Loader2, Check, X, ChevronLeft } from 'lucide-react'
import Link from 'next/link'

export default function CalendarSettingsPage() {
  const [accounts, setAccounts] = useState<any[]>([])
  const [syncs, setSyncs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    const supabase = getSupabaseBrowser()

    const { data: tokens } = await supabase.from('calendar_tokens').select('account, created_at')
    setAccounts(tokens || [])

    const { data: syncData } = await supabase.from('calendar_syncs').select('*').order('last_synced_at', { ascending: false })
    setSyncs(syncData || [])

    setLoading(false)
  }

  async function handleConnect() {
    window.location.href = '/api/auth/google'
  }

  async function handleManualSync() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch('/api/cron/calendar-sync', {
        method: 'POST',
        headers: { 'x-cron-secret': 'manual' },
      })
      const data = await res.json()
      setSyncResult(data.error ? `Error: ${data.error}` : `Synced ${data.events_synced || 0} events from ${data.accounts || 0} account${(data.accounts || 0) !== 1 ? 's' : ''}`)
      loadData()
    } catch (e) {
      setSyncResult('Sync failed')
    }
    setSyncing(false)
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-4 animate-spin text-muted-foreground/40" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-8 animate-in-fade">
      <div>
        <Link href="/settings" className="md:hidden inline-flex items-center gap-1 text-[0.75rem] text-muted-foreground/50 hover:text-foreground transition-colors mb-3">
          <ChevronLeft className="size-3" />Settings
        </Link>
        <h1 className="text-[0.8125rem] font-medium uppercase tracking-[0.1em] mb-1">Calendar Integration</h1>
        <p className="text-[0.75rem] text-muted-foreground/50 leading-relaxed">
          Connect Google Calendar to see upcoming events, find availability, and schedule meetings from chat.
        </p>
      </div>

      {/* Connected Accounts */}
      <div className="border border-border">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <span className="text-[0.625rem] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium">
            Connected Accounts
          </span>
          <button
            onClick={handleConnect}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[0.6875rem] border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
          >
            <Plus className="size-3" /> Connect Calendar
          </button>
        </div>
        <div className="p-5">
          {accounts.length === 0 ? (
            <p className="text-[0.75rem] text-muted-foreground/40">No accounts connected</p>
          ) : (
            <div className="space-y-2">
              {accounts.map((acc, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2.5 bg-muted/30">
                  <Calendar className="size-3.5 text-muted-foreground/40" />
                  <span className="text-[0.8125rem] font-medium flex-1">{acc.account}</span>
                  <span className="text-[0.625rem] uppercase tracking-wider text-green-600">Connected</span>
                  <button
                    onClick={async () => {
                      if (!confirm(`Disconnect calendar for ${acc.account}? You can reconnect anytime.`)) return
                      const supabase = getSupabaseBrowser()
                      await supabase.from('calendar_tokens').delete().eq('account', acc.account)
                      await supabase.from('calendar_syncs').delete().eq('account', acc.account)
                      await supabase.from('calendar_events').delete().eq('account', acc.account)
                      setAccounts(prev => prev.filter(a => a.account !== acc.account))
                      setSyncs(prev => prev.filter(s => s.account !== acc.account))
                    }}
                    className="p-1 text-muted-foreground/30 hover:text-red-500 transition-colors"
                    title="Disconnect account"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Calendar Sync */}
      <div className="border border-border">
        <div className="px-5 py-3 border-b border-border">
          <span className="text-[0.625rem] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium">
            Calendar Sync
          </span>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-[0.75rem] text-muted-foreground/50 leading-relaxed">
            Events are automatically synced every 15 minutes. You can also trigger a manual sync.
          </p>
          <button
            onClick={handleManualSync}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[0.75rem] border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-40"
          >
            {syncing ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>
          {syncResult && (
            <p className="text-[0.75rem] text-muted-foreground/60 flex items-center gap-1.5">
              <Check className="size-3 text-green-600" /> {syncResult}
            </p>
          )}

          {syncs.length > 0 && (
            <div className="pt-4 border-t border-border">
              <span className="text-[0.625rem] uppercase tracking-[0.15em] text-muted-foreground/40 font-medium block mb-3">
                Sync Status
              </span>
              <div className="space-y-1">
                {syncs.map(sync => (
                  <div key={sync.id} className="flex items-center gap-4 text-[0.6875rem] text-muted-foreground/40 tabular-nums">
                    <span className="text-muted-foreground/60">{sync.account}</span>
                    <span>{sync.last_synced_at ? new Date(sync.last_synced_at).toLocaleString() : 'Never'}</span>
                    <span>{sync.events_synced} events</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
