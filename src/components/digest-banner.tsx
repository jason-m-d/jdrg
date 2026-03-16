'use client'

import { useState, useEffect, useRef } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import Link from 'next/link'
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

const PRIORITY_INDICATOR: Record<string, string> = {
  high: 'bg-red-500',
  medium: 'bg-yellow-500',
  low: 'bg-muted-foreground',
}

export function DigestBanner() {
  const [expanded, setExpanded] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [salesData, setSalesData] = useState<Record<string, number>>({})
  const [salesLoaded, setSalesLoaded] = useState(false)
  const [actionItems, setActionItems] = useState<any[]>([])
  const [actionCount, setActionCount] = useState(0)

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

    supabase.from('action_items').select('*').eq('status', 'pending')
      .order('priority').order('created_at', { ascending: false }).limit(3)
      .then(({ data }) => setActionItems(data || []))

    supabase.from('action_items').select('id', { count: 'exact' }).eq('status', 'pending')
      .then(({ count }) => setActionCount(count || 0))
  }, [])

  const wsTotal = WINGSTOP_STORES.reduce((sum, s) => sum + (salesData[s.number] || 0), 0)
  const mpTotal = MP_STORES.reduce((sum, s) => sum + (salesData[s.number] || 0), 0)
  const wsReporting = WINGSTOP_STORES.filter(s => salesData[s.number] !== undefined).length
  const mpReporting = MP_STORES.filter(s => salesData[s.number] !== undefined).length

  if (dismissed) {
    return (
      <button
        onClick={() => setDismissed(false)}
        className="group flex items-center gap-1.5 px-5 py-1.5 text-[11px] text-muted-foreground/60 hover:text-muted-foreground border-b border-border transition-colors"
      >
        <ChevronDown className="size-3 opacity-0 group-hover:opacity-100 transition-opacity" />
        <span className="tracking-wide uppercase">Digest</span>
      </button>
    )
  }

  return (
    <div className="border-b border-border animate-in-fade">
      {/* Summary bar — always visible */}
      <div className="flex items-center justify-between px-5 h-9">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-5 text-[11px] tracking-wide hover:text-foreground transition-colors flex-1 min-w-0"
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
              <span className="text-muted-foreground/40 text-[10px]">{wsReporting}/{WINGSTOP_STORES.length}</span>
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
              <span className="text-muted-foreground/40 text-[10px]">{mpReporting}/{MP_STORES.length}</span>
            </span>

            <span className="w-px h-3 bg-border" />

            <span className="flex items-center gap-1.5">
              <span className="font-medium text-foreground/60">{actionCount}</span>
              <span>action{actionCount !== 1 ? 's' : ''}</span>
            </span>
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
        <div>
          <div className="px-5 pb-4 pt-1">
            {/* Divider */}
            <div className="h-px bg-border mb-3" />

            <div className="grid grid-cols-2 gap-6">
              {/* Sales column */}
              <div className="space-y-3">
                {/* Wingstop */}
                <div>
                  <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70 mb-2">Wingstop</div>
                  <div className="space-y-0.5">
                    {WINGSTOP_STORES.map(store => {
                      const sales = salesData[store.number] ?? null
                      return (
                        <div key={store.number} className="flex items-baseline justify-between text-[12px] py-px">
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
                  <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70 mb-2">Mr. Pickle&apos;s</div>
                  <div className="space-y-0.5">
                    {MP_STORES.map(store => {
                      const sales = salesData[store.number] ?? null
                      return (
                        <div key={store.number} className="flex items-baseline justify-between text-[12px] py-px">
                          <span className="text-muted-foreground">{store.name}</span>
                          <span className={cn('font-medium tabular-nums', salesColor(sales, MP_TARGET))}>
                            {fmtFull(sales)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {salesLoaded && Object.keys(salesData).length === 0 && (
                  <p className="text-[11px] text-muted-foreground/60">Waiting for today&apos;s reports.</p>
                )}
              </div>

              {/* Actions column */}
              <div>
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70">
                    Actions
                    {actionCount > 0 && <span className="ml-1.5 text-foreground/50">{actionCount}</span>}
                  </span>
                  <Link
                    href="/action-items"
                    className="text-[10px] text-muted-foreground/50 hover:text-foreground transition-colors tracking-wide uppercase"
                  >
                    View all
                  </Link>
                </div>
                {actionItems.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground/60">No pending actions.</p>
                ) : (
                  <div className="space-y-1.5">
                    {actionItems.map(item => (
                      <div key={item.id} className="flex items-start gap-2 text-[12px]">
                        <div className={cn('size-1.5 mt-[5px] shrink-0', PRIORITY_INDICATOR[item.priority])} />
                        <span className="text-foreground/80 leading-snug">{item.title}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
