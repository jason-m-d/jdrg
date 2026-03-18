'use client'

import { useState, useEffect } from 'react'
import { ChevronDown, X, RefreshCw } from 'lucide-react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { cn } from '@/lib/utils'

const WINGSTOP_STORES = [
  { number: '326', name: 'Coleman' },
  { number: '451', name: 'Hollenbeck' },
  { number: '895', name: 'McKee' },
  { number: '1870', name: 'Showers' },
  { number: '2067', name: 'Aborn' },
  { number: '2428', name: 'Winchester' },
  { number: '2262', name: 'Stevens Creek' },
  { number: '2289', name: 'Prospect' },
]

const MP_STORES = [
  { number: '405', name: 'Fresno' },
  { number: '1008', name: 'Van Nuys' },
]

const WINGSTOP_TARGET = 8000
const MP_TARGET = 3000

function salesColor(sales: number | null, target: number) {
  if (sales === null || sales === undefined) return 'text-muted-foreground'
  if (sales >= target) return 'text-green-600 dark:text-green-400'
  if (sales >= target * 0.8) return 'text-yellow-600 dark:text-yellow-400'
  return 'text-red-600 dark:text-red-400'
}

function fmt(n: number | null) {
  if (n === null || n === undefined) return '--'
  return '$' + (n / 1000).toFixed(1) + 'K'
}

function fmtFull(n: number | null) {
  if (n === null || n === undefined) return '--'
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function isStaleScanned(dateStr: string) {
  return Date.now() - new Date(dateStr).getTime() > 2 * 60 * 60 * 1000 // >2 hours
}

export function DigestBanner() {
  const [expanded, setExpanded] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [salesData, setSalesData] = useState<Record<string, number>>({})
  const [salesLoaded, setSalesLoaded] = useState(false)
  const [lastScanned, setLastScanned] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<string | null>(null)
  const [sinceLastVisit, setSinceLastVisit] = useState<{
    newSales: number
    newProactive: number
  } | null>(null)

  useEffect(() => {
    const supabase = getSupabaseBrowser()
    const today = new Date().toISOString().split('T')[0]

    supabase.from('sales_data').select('*').eq('report_date', today)
      .then(({ data }) => {
        const map: Record<string, number> = {}
        ;(data || []).forEach((s: any) => { map[s.store_number] = s.net_sales })
        setSalesData(map)
        setSalesLoaded(true)
      })

    supabase.from('email_scans').select('last_scanned_at')
      .order('last_scanned_at', { ascending: false }).limit(1).single()
      .then(({ data }) => setLastScanned(data?.last_scanned_at || null))

    // Since last visit
    fetch('/api/user-state?key=last_visit')
      .then(r => r.json())
      .then(async ({ value }) => {
        const lastVisit = value?.timestamp || null
        if (lastVisit) {
          const [salesRes, proactiveRes] = await Promise.all([
            supabase.from('sales_data').select('id', { count: 'exact', head: true })
              .gte('parsed_at', lastVisit),
            supabase.from('messages').select('id', { count: 'exact', head: true })
              .eq('role', 'assistant')
              .or('content.like.☀️ **Morning Briefing%,content.like.⚡ **Alert%')
              .gte('created_at', lastVisit),
          ])
          const total = (salesRes.count || 0) + (proactiveRes.count || 0)
          if (total > 0) {
            setSinceLastVisit({
              newSales: salesRes.count || 0,
              newProactive: proactiveRes.count || 0,
            })
          }
        }
        // Update last visit to now
        fetch('/api/user-state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'last_visit', value: { timestamp: new Date().toISOString() } }),
        })
      })
      .catch(() => {}) // silently fail if user_state table doesn't exist yet
  }, [])

  async function runScan() {
    setScanning(true)
    setScanResult(null)
    try {
      const res = await fetch('/api/cron/email-scan', {
        method: 'POST',
        headers: { 'x-cron-secret': 'manual' },
      })
      const data = await res.json()
      if (res.ok) {
        setScanResult(`Done — ${data.emails_processed ?? 0} emails, ${data.action_items_found ?? 0} items`)
        // Refresh sales data
        const supabase = getSupabaseBrowser()
        const today = new Date().toISOString().split('T')[0]
        const { data: fresh } = await supabase.from('sales_data').select('*').eq('report_date', today)
        const map: Record<string, number> = {}
        ;(fresh || []).forEach((s: any) => { map[s.store_number] = s.net_sales })
        setSalesData(map)
        setLastScanned(new Date().toISOString())
      } else {
        setScanResult(`Error: ${data.error || 'Scan failed'}`)
      }
    } catch {
      setScanResult('Error: Could not reach server')
    } finally {
      setScanning(false)
    }
  }

  const wsTotal = WINGSTOP_STORES.reduce((sum, s) => sum + (salesData[s.number] || 0), 0)
  const mpTotal = MP_STORES.reduce((sum, s) => sum + (salesData[s.number] || 0), 0)
  const wsReporting = WINGSTOP_STORES.filter(s => salesData[s.number] !== undefined).length
  const mpReporting = MP_STORES.filter(s => salesData[s.number] !== undefined).length

  if (dismissed) {
    return (
      <button
        onClick={() => setDismissed(false)}
        className="group flex items-center gap-1.5 px-5 py-1.5 text-[0.6875rem] text-muted-foreground/60 hover:text-muted-foreground border-b border-border bg-sidebar transition-colors"
      >
        <ChevronDown className="size-3 opacity-0 group-hover:opacity-100 transition-opacity" />
        <span className="tracking-wide uppercase">Digest</span>
      </button>
    )
  }

  return (
    <div className="border-b border-border animate-in-fade bg-sidebar">
      {/* Summary bar — always visible */}
      <div className="flex items-center justify-between px-5 h-9">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-5 text-[0.6875rem] tracking-wide hover:text-foreground transition-colors flex-1 min-w-0"
        >
          <span className="flex items-center gap-4 text-muted-foreground tabular-nums">
            <span className="flex items-center gap-1.5">
              <span className="font-medium text-foreground/60">WS</span>
              <span className={cn(
                'font-medium',
                salesLoaded && wsReporting > 0
                  ? salesColor(wsTotal / Math.max(wsReporting, 1), WINGSTOP_TARGET)
                  : 'text-muted-foreground'
              )}>
                {salesLoaded && wsReporting > 0 ? fmt(wsTotal) : '--'}
              </span>
              <span className="text-muted-foreground/40 text-[0.625rem]">{wsReporting}/{WINGSTOP_STORES.length}</span>
            </span>

            <span className="w-px h-3 bg-border" />

            <span className="flex items-center gap-1.5">
              <span className="font-medium text-foreground/60">MP</span>
              <span className={cn(
                'font-medium',
                salesLoaded && mpReporting > 0
                  ? salesColor(mpTotal / Math.max(mpReporting, 1), MP_TARGET)
                  : 'text-muted-foreground'
              )}>
                {salesLoaded && mpReporting > 0 ? fmt(mpTotal) : '--'}
              </span>
              <span className="text-muted-foreground/40 text-[0.625rem]">{mpReporting}/{MP_STORES.length}</span>
            </span>

            {lastScanned && (
              <>
                <span className="w-px h-3 bg-border" />
                <span className={cn(
                  'text-[0.625rem]',
                  isStaleScanned(lastScanned) ? 'text-amber-500/70' : 'text-muted-foreground/40'
                )}>
                  Scanned {timeAgo(lastScanned)}
                </span>
              </>
            )}

            {sinceLastVisit && (
              <>
                <span className="w-px h-3 bg-border" />
                <span className="text-[0.625rem] text-blue-500/60">
                  {[
                    sinceLastVisit.newSales > 0 && `${sinceLastVisit.newSales} sales update${sinceLastVisit.newSales !== 1 ? 's' : ''}`,
                    sinceLastVisit.newProactive > 0 && `${sinceLastVisit.newProactive} briefing${sinceLastVisit.newProactive !== 1 ? 's' : ''}`,
                  ].filter(Boolean).join(', ')} since last visit
                </span>
              </>
            )}
          </span>

          <ChevronDown className={cn(
            "size-3 text-muted-foreground/50 transition-transform duration-200",
            expanded && "rotate-180"
          )} />
        </button>

        <button
          onClick={() => setDismissed(true)}
          className="ml-3 p-0.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
        >
          <X className="size-3" />
        </button>
      </div>

      {/* Expandable detail — animated with CSS grid */}
      <div className="digest-expand" data-expanded={expanded}>
        <div onClick={() => setExpanded(false)} className="cursor-pointer">
          <div className="px-5 pb-4 pt-1">
            {/* Divider */}
            <div className="h-px bg-border mb-3" />

            <div className="grid grid-cols-2 gap-6">
              {/* Wingstop */}
              <div>
                <div className="text-[0.625rem] uppercase tracking-[0.15em] text-muted-foreground/70 mb-2">Wingstop</div>
                <div className="space-y-0.5">
                  {WINGSTOP_STORES.map(store => {
                    const sales = salesData[store.number] ?? null
                    return (
                      <div key={store.number} className="flex items-baseline justify-between text-[0.75rem] py-px">
                        <span className="text-muted-foreground">{store.name}</span>
                        <span className={cn('font-medium tabular-nums', salesColor(sales, WINGSTOP_TARGET))}>
                          {fmtFull(sales)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Mr Pickle's */}
              <div>
                <div className="text-[0.625rem] uppercase tracking-[0.15em] text-muted-foreground/70 mb-2">Mr. Pickle&apos;s</div>
                <div className="space-y-0.5">
                  {MP_STORES.map(store => {
                    const sales = salesData[store.number] ?? null
                    return (
                      <div key={store.number} className="flex items-baseline justify-between text-[0.75rem] py-px">
                        <span className="text-muted-foreground">{store.name}</span>
                        <span className={cn('font-medium tabular-nums', salesColor(sales, MP_TARGET))}>
                          {fmtFull(sales)}
                        </span>
                      </div>
                    )
                  })}
                </div>

                {salesLoaded && Object.keys(salesData).length === 0 && (
                  <p className="text-[0.6875rem] text-muted-foreground/60 mt-3">Waiting for today&apos;s reports.</p>
                )}
              </div>
            </div>

            {/* Manual scan trigger */}
            <div className="mt-3 pt-3 border-t border-border flex items-center gap-3" onClick={e => e.stopPropagation()}>
              <button
                onClick={runScan}
                disabled={scanning}
                className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                <RefreshCw className={cn('size-3', scanning && 'animate-spin')} />
                {scanning ? 'Scanning...' : 'Run email scan now'}
              </button>
              {scanResult && (
                <span className="text-[0.6875rem] text-muted-foreground/60">{scanResult}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
