/**
 * Prefetch endpoint — called while the user is typing to get an early intent
 * classification. Powers two things:
 *   1. Specialist chips shown above the input
 *   2. Inline autocomplete suggestions (Gmail Smart Compose style)
 *
 * Results are cached server-side for 10s so the real chat POST can skip the
 * router call entirely when the message matches.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { routeMessage } from '@/lib/router'
import type { RouterResult } from '@/lib/router'

export const maxDuration = 15

// ---------------------------------------------------------------------------
// Prefetch result cache — in-process cache for deduplicating rapid prefetch
// calls for the same partial message within the same serverless instance.
// ---------------------------------------------------------------------------
interface CacheEntry {
  result: PrefetchResult
  routerResult: RouterResult
  timestamp: number
}

const prefetchCache = new Map<string, CacheEntry>()
const PREFETCH_TTL_MS = 10_000

function evictStale() {
  const cutoff = Date.now() - PREFETCH_TTL_MS
  for (const [key, entry] of prefetchCache) {
    if (entry.timestamp < cutoff) prefetchCache.delete(key)
  }
}

// ---------------------------------------------------------------------------
// Context bundle — lightweight data loaded once and cached for 5 minutes.
// Used for autocomplete string matching only — no AI needed.
// ---------------------------------------------------------------------------
interface ContextBundle {
  contacts: { name: string; role: string | null; email: string | null; notes: string | null }[]
  projects: { id: string; name: string }[]
  storeNumbers: string[]  // e.g. ["326", "895", "1870", ...]
  recentActionItems: string[]
  loadedAt: number
}

let contextBundle: ContextBundle | null = null
const CONTEXT_BUNDLE_TTL_MS = 5 * 60_000

async function getContextBundle(): Promise<ContextBundle> {
  if (contextBundle && Date.now() - contextBundle.loadedAt < CONTEXT_BUNDLE_TTL_MS) {
    return contextBundle
  }

  const [contactsRes, projectsRes, salesRes, actionItemsRes] = await Promise.all([
    supabaseAdmin.from('contacts').select('name, role, email, notes').order('name'),
    supabaseAdmin.from('projects').select('id, name').order('name'),
    supabaseAdmin.from('sales_data').select('store_number').limit(100),
    supabaseAdmin.from('action_items').select('title').in('status', ['pending', 'approved']).order('created_at', { ascending: false }).limit(10),
  ])

  const storeNumberSet = new Set<string>()
  for (const row of salesRes.data || []) {
    if (row.store_number) storeNumberSet.add(String(row.store_number))
  }

  contextBundle = {
    contacts: (contactsRes.data || []).map((c: any) => ({
      name: c.name || '',
      role: c.role || null,
      email: c.email || null,
      notes: c.notes || null,
    })),
    projects: (projectsRes.data || []).map((p: any) => ({ id: p.id, name: p.name || '' })),
    storeNumbers: Array.from(storeNumberSet),
    recentActionItems: (actionItemsRes.data || []).map((a: any) => a.title || ''),
    loadedAt: Date.now(),
  }

  return contextBundle
}

// ---------------------------------------------------------------------------
// Specialist chip mapping
// ---------------------------------------------------------------------------
const TOOL_TO_SPECIALIST: { tools: string[]; label: string }[] = [
  { tools: ['search_gmail', 'draft_email'], label: 'Email' },
  { tools: ['check_calendar', 'find_availability', 'create_calendar_event'], label: 'Calendar' },
  { tools: ['query_sales'], label: 'Sales' },
  { tools: ['manage_action_items'], label: 'Tasks' },
  { tools: ['search_texts'], label: 'Texts' },
  { tools: ['search_web'], label: 'Web Search' },
  { tools: ['manage_artifact'], label: 'Documents' },
  { tools: ['manage_contacts'], label: 'Contacts' },
  { tools: ['manage_notepad'], label: 'Notes' },
  { tools: ['manage_dashboard'], label: 'Dashboard' },
]

function buildSpecialists(routerRes: RouterResult): string[] {
  const toolSet = new Set(routerRes.tools_needed)
  const dataSet = new Set(routerRes.data_needed)
  const specialists: string[] = []

  for (const { tools, label } of TOOL_TO_SPECIALIST) {
    if (tools.some(t => toolSet.has(t))) specialists.push(label)
  }

  // Memory specialist only when no more specific specialist already matched
  if (
    specialists.length === 0 &&
    (dataSet.has('memories') || dataSet.has('documents_rag') || dataSet.has('context_chunks'))
  ) {
    specialists.push('Memory')
  }

  return specialists
}

// ---------------------------------------------------------------------------
// Cache key — stable hash of data_needed + tools_needed for cache comparisons
// ---------------------------------------------------------------------------
function buildCacheKey(dataNeeded: string[], toolsNeeded: string[]): string {
  const sorted = [...dataNeeded].sort().join(',') + '|' + [...toolsNeeded].sort().join(',')
  // Simple djb2-style hash to keep it short
  let hash = 5381
  for (let i = 0; i < sorted.length; i++) {
    hash = ((hash << 5) + hash) ^ sorted.charCodeAt(i)
    hash = hash >>> 0  // keep unsigned 32-bit
  }
  return hash.toString(16)
}

// ---------------------------------------------------------------------------
// Autocomplete — pure string matching against the context bundle
// ---------------------------------------------------------------------------
const WINGSTOP_STORES: Record<string, string> = {
  '326': 'Coleman (326)',
  '451': 'Store 451',
  '895': 'Store 895',
  '1870': 'Store 1870',
  '2067': 'Store 2067',
  '2428': 'Store 2428',
  '2262': 'Store 2262',
  '2289': 'Store 2289',
}

interface AutocompleteSuggestion {
  text: string
  source: string
}

function buildAutocomplete(
  partial: string,
  routerRes: RouterResult,
  ctx: ContextBundle,
): AutocompleteSuggestion[] {
  const lower = partial.toLowerCase()
  const words = lower.trim().split(/\s+/)
  const lastWord = words[words.length - 1] || ''
  const toolSet = new Set(routerRes.tools_needed)
  const suggestions: AutocompleteSuggestion[] = []

  // Helper: add suggestion only if text is non-empty and not already included
  const seen = new Set<string>()
  function add(text: string, source: string) {
    if (!text || seen.has(text.toLowerCase())) return
    seen.add(text.toLowerCase())
    suggestions.push({ text, source })
  }

  // 1. Person name mentions — "message X", "email X", "tell X", "contact X", "reach out to X"
  const contactTrigger = /\b(message|email|tell|contact|reach out to|text|call|ping|ask|update|notify)\s+(\w+)$/i
  const contactMatch = partial.match(contactTrigger)
  if (contactMatch) {
    const nameFragment = contactMatch[2].toLowerCase()
    for (const c of ctx.contacts) {
      const firstName = c.name.split(' ')[0].toLowerCase()
      if (firstName.startsWith(nameFragment) && firstName !== nameFragment) {
        const suffix = c.role ? ` (${c.role})` : ''
        add(c.name.slice(nameFragment.length) + suffix, 'contact')
      } else if (c.name.toLowerCase().startsWith(nameFragment) && c.name.toLowerCase() !== nameFragment) {
        add(c.name.slice(nameFragment.length), 'contact')
      }
    }
  }

  // 2. Standalone first name at end of message — suggest full name + role
  if (lastWord.length >= 2 && !contactTrigger.test(partial)) {
    for (const c of ctx.contacts) {
      const nameLower = c.name.toLowerCase()
      const firstNameLower = c.name.split(' ')[0].toLowerCase()
      if (firstNameLower.startsWith(lastWord) && firstNameLower !== lastWord) {
        const rest = c.name.slice(lastWord.length)
        const suffix = c.role ? ` (${c.role})` : ''
        add(rest + suffix, 'contact')
      } else if (nameLower.startsWith(lastWord) && nameLower !== lastWord) {
        add(c.name.slice(lastWord.length), 'contact')
      }
    }
  }

  // 3. Store number mentions — suggest store name/context
  const storeMatch = partial.match(/\b(at|for|store|#)?\s*(\d{3,4})\s*$/i)
  if (storeMatch && toolSet.has('query_sales')) {
    const num = storeMatch[2]
    const storeName = WINGSTOP_STORES[num]
    if (storeName && !lower.includes(storeName.toLowerCase())) {
      add(`(${storeName})`, 'store')
    }
    // Suggest GM from contacts notes
    for (const c of ctx.contacts) {
      if (c.notes && c.notes.includes(num)) {
        add(`- talk to ${c.name}`, 'contact')
        break
      }
    }
  }

  // 4. "how did" / "sales at" / "how is" + partial store name → suggest store numbers
  const salesIntro = /\b(how did|sales at|how is|performance at|revenue at|how's)\s*(\w*)$/i
  const salesMatch = partial.match(salesIntro)
  if (salesMatch && toolSet.has('query_sales')) {
    const fragment = salesMatch[2].toLowerCase()
    for (const num of ctx.storeNumbers) {
      if (num.startsWith(fragment) && num !== fragment) {
        add(num.slice(fragment.length), 'store')
      }
    }
    for (const [num, name] of Object.entries(WINGSTOP_STORES)) {
      if (name.toLowerCase().startsWith(fragment) && !fragment.endsWith(num)) {
        add(name.slice(fragment.length), 'store')
      }
    }
  }

  // 5. Project name completions — if partial matches a project name prefix
  for (const p of ctx.projects) {
    const nameLower = p.name.toLowerCase()
    if (nameLower.startsWith(lastWord) && nameLower !== lastWord && lastWord.length >= 3) {
      add(p.name.slice(lastWord.length), 'project')
    }
    // Fuzzy: message contains a fragment of the project name
    for (const word of words.slice(-3)) {
      if (word.length >= 4 && nameLower.includes(word) && !lower.includes(nameLower)) {
        add(p.name, 'project')
        break
      }
    }
  }

  // Return up to 3, exact prefix matches first (already ordered by loop order above)
  return suggestions.slice(0, 3)
}

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------
export interface PrefetchResult {
  specialists: string[]
  data_needed: string[]
  tools_needed: string[]
  rag_query: string | null
  cache_key: string
  autocomplete: AutocompleteSuggestion[]
}

const EMPTY_RESULT: PrefetchResult = {
  specialists: [],
  data_needed: [],
  tools_needed: [],
  rag_query: null,
  cache_key: '',
  autocomplete: [],
}

// ---------------------------------------------------------------------------
// Cache lookup — called by the main chat POST to skip the router when
// the user's final message matches a recent prefetch result.
// ---------------------------------------------------------------------------
export function getPrefetchedRouterResult(message: string): RouterResult | null {
  evictStale()
  const entry = prefetchCache.get(message.trim())
  if (!entry) return null
  console.log(`[Chat] prefetch cache hit — skipping router call`)
  return entry.routerResult
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const timeoutAt = Date.now() + 5000

  try {
    const { partial_message, recent_messages = [] } = await req.json()

    if (!partial_message || typeof partial_message !== 'string' || partial_message.trim().length < 2) {
      return NextResponse.json(EMPTY_RESULT)
    }

    const trimmed = partial_message.trim()

    // Check server-side cache first
    evictStale()
    const cached = prefetchCache.get(trimmed)
    if (cached) {
      console.log(`[Prefetch] cache hit: "${trimmed.slice(0, 50)}"`)
      return NextResponse.json(cached.result)
    }

    // Race the entire classification against the remaining time budget
    const remaining = timeoutAt - Date.now()
    if (remaining <= 0) return NextResponse.json(EMPTY_RESULT)

    const [routerRes, ctx] = await Promise.race([
      Promise.all([
        routeMessage(trimmed, recent_messages, [], 'google/gemini-3.1-flash-lite-preview'),
        getContextBundle(),
      ]),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Prefetch timeout')), remaining)
      ),
    ])

    const specialists = buildSpecialists(routerRes)
    const cacheKey = buildCacheKey(routerRes.data_needed, routerRes.tools_needed)
    const autocomplete = buildAutocomplete(trimmed, routerRes, ctx)

    const result: PrefetchResult = {
      specialists,
      data_needed: routerRes.data_needed,
      tools_needed: routerRes.tools_needed,
      rag_query: routerRes.rag_query,
      cache_key: cacheKey,
      autocomplete,
    }

    // Store in cache for the chat POST to reuse
    prefetchCache.set(trimmed, { result, routerResult: routerRes, timestamp: Date.now() })

    console.log(`[Prefetch] "${trimmed.slice(0, 50)}" → specialists: [${specialists.join(', ')}] | autocomplete: ${autocomplete.length}`)
    return NextResponse.json(result)

  } catch (err: any) {
    const isTimeout = err?.message === 'Prefetch timeout'
    console.warn(`[Prefetch] ${isTimeout ? 'timeout' : 'error'}:`, err?.message)
    return NextResponse.json(EMPTY_RESULT)
  }
}
