'use client'

import { useState, useEffect } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { Mail, RefreshCw, Plus, Loader2, Check, X, ChevronLeft } from 'lucide-react'
import Link from 'next/link'

export default function EmailSettingsPage() {
  const [accounts, setAccounts] = useState<any[]>([])
  const [scans, setScans] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    const supabase = getSupabaseBrowser()

    const { data: tokens } = await supabase.from('google_tokens').select('account, created_at')
    setAccounts(tokens || [])

    const { data: scanData } = await supabase.from('email_scans').select('*').order('last_scanned_at', { ascending: false })
    setScans(scanData || [])

    setLoading(false)
  }

  async function handleConnect() {
    window.location.href = '/api/auth/google'
  }

  async function handleManualScan() {
    setScanning(true)
    setScanResult(null)
    try {
      const res = await fetch('/api/cron/email-scan', {
        method: 'POST',
        headers: { 'x-cron-secret': 'manual' },
      })
      const data = await res.json()
      setScanResult(data.error ? `Error: ${data.error}` : `Scanned ${data.emails_processed || 0} emails, found ${data.action_items_found || 0} action items`)
      loadData()
    } catch (e) {
      setScanResult('Scan failed')
    }
    setScanning(false)
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
        <h1 className="text-[0.8125rem] font-medium uppercase tracking-[0.1em] mb-1">Email Integration</h1>
        <p className="text-[0.75rem] text-muted-foreground/50 leading-relaxed">
          Connect Gmail accounts for automatic action item extraction and sales data parsing.
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
            <Plus className="size-3" /> Connect Gmail
          </button>
        </div>
        <div className="p-5">
          {accounts.length === 0 ? (
            <p className="text-[0.75rem] text-muted-foreground/40">No accounts connected</p>
          ) : (
            <div className="space-y-2">
              {accounts.map((acc, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2.5 bg-muted/30">
                  <Mail className="size-3.5 text-muted-foreground/40" />
                  <span className="text-[0.8125rem] font-medium flex-1">{acc.account}</span>
                  <span className="text-[0.625rem] uppercase tracking-wider text-green-600">Connected</span>
                  <button
                    onClick={async () => {
                      if (!confirm(`Disconnect ${acc.account}? You can reconnect anytime.`)) return
                      const supabase = getSupabaseBrowser()
                      await supabase.from('google_tokens').delete().eq('account', acc.account)
                      await supabase.from('email_scans').delete().eq('account', acc.account)
                      setAccounts(prev => prev.filter(a => a.account !== acc.account))
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

      {/* Email Scanning */}
      <div className="border border-border">
        <div className="px-5 py-3 border-b border-border">
          <span className="text-[0.625rem] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium">
            Email Scanning
          </span>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-[0.75rem] text-muted-foreground/50 leading-relaxed">
            Emails are automatically scanned every hour. You can also trigger a manual scan.
          </p>
          <button
            onClick={handleManualScan}
            disabled={scanning}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[0.75rem] border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-40"
          >
            {scanning ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
            {scanning ? 'Scanning...' : 'Scan Now'}
          </button>
          {scanResult && (
            <p className="text-[0.75rem] text-muted-foreground/60 flex items-center gap-1.5">
              <Check className="size-3 text-green-600" /> {scanResult}
            </p>
          )}

          {scans.length > 0 && (
            <div className="pt-4 border-t border-border">
              <span className="text-[0.625rem] uppercase tracking-[0.15em] text-muted-foreground/40 font-medium block mb-3">
                Recent Scans
              </span>
              <div className="space-y-1">
                {scans.slice(0, 5).map(scan => (
                  <div key={scan.id} className="flex items-center gap-4 text-[0.6875rem] text-muted-foreground/40 tabular-nums">
                    <span className="text-muted-foreground/60">{scan.account}</span>
                    <span>{new Date(scan.last_scanned_at).toLocaleString()}</span>
                    <span>{scan.emails_processed} emails</span>
                    <span>{scan.action_items_found} items</span>
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
