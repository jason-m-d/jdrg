import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchEmails } from '@/lib/gmail'
import { getMainConversation, insertProactiveMessage, getUserPreferences } from '@/lib/proactive'
import { buildFewShotBlock } from '@/lib/training'
import { sendPushToAll } from '@/lib/push'
import { spawnBackgroundJob, isAutoTriggerRateLimited, getDailyAutoTriggerCount, logAutoTrigger } from '@/lib/background-jobs'
import { openrouterClient } from '@/lib/openrouter'

// Anthropic client used only for Claude models (main chat, etc.)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL })

// Background Google model calls go through openrouterClient (OpenAI-compatible)
// to avoid the Anthropic SDK header that forces routing to Anthropic providers.
const BACKGROUND_MODEL = 'google/gemini-2.0-flash-001'
const BACKGROUND_FALLBACK = 'google/gemini-flash-1.5'

// extra_body for openrouterClient calls (passed as request_options body extras)
function jsonBody(schema: Record<string, unknown>) {
  return {
    models: [BACKGROUND_MODEL, BACKGROUND_FALLBACK],
    provider: { sort: 'price' },
    plugins: [{ id: 'response-healing' }],
    response_format: { type: 'json_schema', json_schema: { name: 'response', strict: true, schema } },
  }
}

// Keep BACKGROUND_EXTRA_BODY for the Anthropic-SDK alert call (uses Claude-compatible path)
const BACKGROUND_EXTRA_BODY = { extra_body: { models: [BACKGROUND_MODEL, BACKGROUND_FALLBACK], provider: { sort: 'price' } } }

// Legacy helper kept for the alert call which still uses the Anthropic client
function jsonExtraBody(schema: Record<string, unknown>) {
  return {
    extra_body: {
      ...BACKGROUND_EXTRA_BODY.extra_body,
      plugins: [{ id: 'response-healing' }],
      response_format: { type: 'json_schema', json_schema: { name: 'response', strict: true, schema } },
    },
  }
}

const WINGSTOP_STORES = ['326', '451', '895', '1870', '2067', '2428', '2262', '2289']

// Jason's email addresses for determining email direction
const JASON_EMAILS = ['jason@demayorestaurantgroup.com', 'jason@hungryhospitality.com', 'jasondemayo@gmail.com']

function extractEmail(headerValue: string): string {
  const match = headerValue.match(/<([^>]+)>/)
  return (match ? match[1] : headerValue).toLowerCase().trim()
}

const EMAIL_EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    action_items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          due_date: { type: ['string', 'null'] },
          source_snippet: { type: 'string' },
          confidence: { type: 'number' },
          related_project: { type: ['string', 'null'] },
        },
        required: ['title', 'description', 'priority', 'due_date', 'source_snippet', 'confidence', 'related_project'],
        additionalProperties: false,
      },
    },
    updates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          item_id: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          due_date: { type: ['string', 'null'] },
        },
        required: ['item_id', 'description', 'priority', 'due_date'],
        additionalProperties: false,
      },
    },
    needs_response: { type: 'boolean' },
    is_automated: { type: 'boolean' },
  },
  required: ['action_items', 'updates', 'needs_response', 'is_automated'],
  additionalProperties: false,
}

const WINGSTOP_SALES_SCHEMA = {
  type: 'object',
  properties: {
    stores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          store_number: { type: 'string' },
          store_name: { type: 'string' },
          net_sales: { type: 'number' },
          forecast_sales: { type: ['number', 'null'] },
          budget_sales: { type: ['number', 'null'] },
          report_date: { type: 'string' },
        },
        required: ['store_number', 'store_name', 'net_sales', 'forecast_sales', 'budget_sales', 'report_date'],
        additionalProperties: false,
      },
    },
  },
  required: ['stores'],
  additionalProperties: false,
}

const MR_PICKLES_SALES_SCHEMA = {
  type: 'object',
  properties: {
    stores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          store_number: { type: 'string' },
          store_name: { type: 'string' },
          net_sales: { type: 'number' },
          report_date: { type: 'string' },
        },
        required: ['store_number', 'store_name', 'net_sales', 'report_date'],
        additionalProperties: false,
      },
    },
  },
  required: ['stores'],
  additionalProperties: false,
}

const EMAIL_EXTRACTION_PROMPT = `You extract action items from emails for Jason DeMayo, CEO of DeMayo Restaurant Group (8 Wingstop locations) and Hungry Hospitality Group (2 Mr. Pickle's locations).

ONLY extract an action item if it meets at least one of these criteria:
1. Bad for business if ignored - compliance, legal, health dept, franchise requirements, violations
2. Someone explicitly asking Jason to do something with urgency or a deadline
3. Needs to be communicated to GMs, Roger, Eli, or another key contact
4. Financial action required - payments, tax, insurance, leases, vendor issues
5. AI spots a risk or opportunity Jason should address (e.g. anomalous sales data, staffing crisis)

DO NOT extract items from:
- FYI emails, newsletters, or marketing
- Routine reports with no anomalies or action needed
- Automated notifications (order confirmations, receipts, system alerts)
- Vague or nice-to-have suggestions
- Items that are purely informational with no required action

EXISTING ACTION ITEMS (do not create duplicates - if an email relates to an existing item, use "updates" to modify it instead):
{EXISTING_ITEMS}

ACTIVE PROJECTS (if an action item clearly relates to a project, include the project name in "related_project"):
{PROJECTS}

For each action item, include a "confidence" score (0.0-1.0).
1.0 = certain this is an action item. 0.7-0.9 = likely. 0.5-0.7 = uncertain. Below 0.5 = probably not, don't include.

Also classify each email:
- "needs_response": true if this email is from a real person (not automated) and expects or would benefit from a reply from Jason. false for FYI, newsletters, automated, or already-answered threads.
- "is_automated": true if this is an automated/system email (order confirmations, alerts, reports, newsletters, no-reply senders). false if from a real person.

Return JSON:
{
  "action_items": [{"title": "...", "description": "...", "priority": "high|medium|low", "due_date": null, "source_snippet": "...", "confidence": 0.9, "related_project": "Project Name or null"}],
  "updates": [{"item_id": "uuid", "description": "updated description", "priority": "high|medium|low", "due_date": "2026-01-20"}],
  "needs_response": true,
  "is_automated": false
}

Return {"action_items": [], "updates": [], "needs_response": false, "is_automated": true} for automated emails with no action items.`

export const maxDuration = 60

export async function POST(req: NextRequest) {
  // Validate secret (cron or manual)
  const cronSecret = req.headers.get('x-cron-secret') || req.headers.get('authorization')
  if (cronSecret !== process.env.CRON_SECRET && cronSecret !== 'manual' && cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let totalProcessed = 0
  let totalItems = 0

  // Load active notification rules
  const { data: notificationRules } = await supabaseAdmin
    .from('notification_rules')
    .select('description, match_type, match_value')
    .eq('is_active', true)

  // Get all connected accounts
  const { data: accounts } = await supabaseAdmin.from('gmail_tokens').select('account')
  if (!accounts || accounts.length === 0) {
    return NextResponse.json({ message: 'No accounts connected', emails_processed: 0, action_items_found: 0 })
  }

  // Load existing action items for dedup + projects for association
  const [{ data: existingItems }, { data: projects }] = await Promise.all([
    supabaseAdmin
      .from('action_items')
      .select('id, title, description, status, priority, due_date')
      .in('status', ['pending', 'approved'])
      .order('created_at', { ascending: false })
      .limit(30),
    supabaseAdmin
      .from('projects')
      .select('id, name, description')
      .order('name'),
  ])

  const existingItemsList = (existingItems || [])
    .map((item: any) => `- [${item.id}] "${item.title}" (${item.status}, ${item.priority})${item.due_date ? ` due: ${item.due_date}` : ''}`)
    .join('\n') || '(none)'

  const projectsList = (projects || [])
    .map((p: any) => `- "${p.name}"${p.description ? `: ${p.description}` : ''}`)
    .join('\n') || '(none)'

  const systemPrompt = EMAIL_EXTRACTION_PROMPT
    .replace('{EXISTING_ITEMS}', existingItemsList)
    .replace('{PROJECTS}', projectsList)

  for (const { account } of accounts) {
    try {
      // Get last scan time
      const { data: scan } = await supabaseAdmin
        .from('email_scans')
        .select('last_scanned_at')
        .eq('account', account)
        .single()

      const since = scan?.last_scanned_at ? new Date(scan.last_scanned_at) : new Date(Date.now() - 3600000) // default 1 hour ago

      // PRIORITY: Fetch and process sales emails first with targeted queries
      const salesQueries = [
        { q: 'subject:"NBO Daily Reports" subject:DeMayo', brand: 'wingstop' },
        { q: 'subject:[MP] subject:"Daily Sales"', brand: 'mrpickles' },
      ]
      for (const { q, brand } of salesQueries) {
        try {
          const salesEmails = await fetchEmails(account, since, 5, q)
          console.log(`[email-scan] SALES ${brand}: found ${salesEmails.length} emails`)
          for (const email of salesEmails) {
            console.log(`[email-scan] SALES ${brand}: "${email.subject}" (${email.attachments?.length || 0} PDFs)`)
            if (brand === 'wingstop') {
              await parseWingstopSales(email)
            } else {
              await parseMrPicklesSales(email)
            }
            console.log(`[email-scan] SALES ${brand}: parsing complete`)
          }
        } catch (e: any) {
          console.error(`[email-scan] SALES_ERR ${brand}: ${e.message?.slice(0, 150)}`)
        }
      }

      // Now fetch regular emails for action item extraction
      const emails = await fetchEmails(account, since, 15)
      console.log(`[email-scan] ${account}: fetched ${emails.length} emails since ${since.toISOString()}`)
      let itemsFound = 0

      for (const email of emails) {

        // Check notification rules and push if matched
        if (notificationRules?.length) {
          for (const rule of notificationRules) {
            const val = rule.match_value.toLowerCase()
            let matched = false

            if (rule.match_type === 'sender') {
              matched = email.from.toLowerCase().includes(val)
            } else if (rule.match_type === 'subject') {
              matched = email.subject.toLowerCase().includes(val)
            } else if (rule.match_type === 'keyword') {
              matched = email.from.toLowerCase().includes(val) ||
                email.subject.toLowerCase().includes(val) ||
                email.body.toLowerCase().includes(val)
            }

            if (matched) {
              await sendPushToAll(
                rule.description,
                `From: ${email.from}\nSubject: ${email.subject}`,
                '/dashboard'
              )
              break // one notification per email max
            }
          }
        }

        // Extract action items via Claude
        try {
          // Build few-shot context from training examples
          const emailText = `From: ${email.from}\nSubject: ${email.subject}\n\n${email.body.slice(0, 3000)}`
          const fewShotBlock = await buildFewShotBlock(emailText).catch(() => null)
          const fullSystemPrompt = fewShotBlock
            ? `${systemPrompt}\n\n${fewShotBlock}`
            : systemPrompt

          const response = await openrouterClient.chat.completions.create({
            model: 'google/gemini-3.1-flash-lite-preview',
            max_tokens: 1024,
            messages: [
              { role: 'system', content: fullSystemPrompt },
              { role: 'user', content: emailText },
            ],
            ...jsonBody(EMAIL_EXTRACTION_SCHEMA),
          } as any)

          const text = response.choices[0]?.message?.content || ''
          let parsed: any
          try {
            parsed = JSON.parse(text)
          } catch {
            // Fallback: strip markdown fences and extract JSON
            try {
              let cleaned = text.trim()
              if (cleaned.startsWith('```')) {
                cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
              }
              const match = cleaned.match(/\{[\s\S]*\}/)
              parsed = match ? JSON.parse(match[0]) : JSON.parse(cleaned)
            } catch {
              console.error('[email-scan] Failed to parse extraction response:', text.slice(0, 200))
              continue
            }
          }

          // Handle new action items
          if (parsed.action_items?.length > 0) {
            const isHighPriority = email.from.includes('@wingstop.com') ||
              WINGSTOP_STORES.some(s => email.body.includes(s) || email.subject.includes(s))

            for (const item of parsed.action_items) {
              // If the AI identified a related project, note it in the description
              const projectNote = item.related_project
                ? `\n\n[Related project: ${item.related_project}]`
                : ''
              await supabaseAdmin.from('action_items').insert({
                title: item.title,
                description: (item.description || '') + projectNote,
                source: 'email',
                source_id: email.id,
                source_snippet: item.source_snippet || email.subject,
                priority: isHighPriority ? 'high' : (item.priority || 'medium'),
                due_date: item.due_date || null,
                confidence: typeof item.confidence === 'number' ? item.confidence : null,
              })
              itemsFound++
            }
          }

          // Handle updates to existing items
          if (parsed.updates?.length > 0) {
            for (const update of parsed.updates) {
              if (!update.item_id) continue
              const updates: Record<string, any> = { updated_at: new Date().toISOString() }
              if (update.description) updates.description = update.description
              if (update.priority) updates.priority = update.priority
              if (update.due_date) updates.due_date = update.due_date

              await supabaseAdmin
                .from('action_items')
                .update(updates)
                .eq('id', update.item_id)
            }
          }

          // Track email thread for response detection
          if (!parsed.is_automated && email.threadId) {
            const senderEmail = extractEmail(email.from)
            const isFromJason = JASON_EMAILS.includes(senderEmail)
            const messageDate = email.internalDate
              ? new Date(parseInt(email.internalDate)).toISOString()
              : new Date().toISOString()

            if (isFromJason) {
              // Jason sent this — mark thread as having a response
              await supabaseAdmin.from('email_threads').upsert({
                gmail_thread_id: email.threadId,
                gmail_account: account,
                subject: email.subject,
                last_sender: email.from.replace(/<[^>]+>/, '').trim(),
                last_sender_email: senderEmail,
                last_message_date: messageDate,
                direction: 'outbound',
                needs_response: false,
                response_detected: true,
                updated_at: new Date().toISOString(),
              }, { onConflict: 'gmail_thread_id,gmail_account' })
            } else {
              // Someone else sent this — check if it needs a response
              const needsResponse = parsed.needs_response === true

              // Only update if this message is newer (upsert will overwrite)
              await supabaseAdmin.from('email_threads').upsert({
                gmail_thread_id: email.threadId,
                gmail_account: account,
                subject: email.subject,
                last_sender: email.from.replace(/<[^>]+>/, '').trim(),
                last_sender_email: senderEmail,
                last_message_date: messageDate,
                direction: 'inbound',
                needs_response: needsResponse,
                response_detected: false,
                updated_at: new Date().toISOString(),
              }, { onConflict: 'gmail_thread_id,gmail_account' })
            }
          }
        } catch (e: any) {
          console.error(`[email-scan] Failed to process email ${email.id}: ${e.message}`)
        }

        // Update last_scanned_at after each email so we don't re-process on timeout
        await supabaseAdmin.from('email_scans').upsert({
          account,
          last_scanned_at: email.internalDate
            ? new Date(parseInt(email.internalDate)).toISOString()
            : new Date().toISOString(),
          emails_processed: totalProcessed + emails.indexOf(email) + 1,
          action_items_found: totalItems + itemsFound,
        }, { onConflict: 'account' })
      }

      totalProcessed += emails.length
      totalItems += itemsFound

      // Final update with accurate totals
      await supabaseAdmin.from('email_scans').upsert({
        account,
        last_scanned_at: new Date().toISOString(),
        emails_processed: emails.length,
        action_items_found: itemsFound,
      }, { onConflict: 'account' })

    } catch (e: any) {
      console.error(`[email-scan] SCAN_ERR name=${e.name}`)
      console.error(`[email-scan] SCAN_ERR msg=${e.message?.slice(0, 200)}`)
      console.error(`[email-scan] SCAN_ERR stack=${e.stack?.slice(0, 200)}`)
    }
  }

  // Post-scan alerts: check if anything noteworthy warrants an alert
  try {
    await maybeGenerateAlert(totalItems)
  } catch (e) {
    console.error('Alert generation failed:', e)
  }

  // Phase 3: Auto-triggers (fire-and-forget)
  const convId = await getMainConversation()
  maybeSpawnSalesAnomalyResearch(convId).catch(e => console.error('Sales anomaly trigger failed:', e))

  return NextResponse.json({ emails_processed: totalProcessed, action_items_found: totalItems })
}

async function maybeGenerateAlert(newActionItemCount: number) {
  // Check if we should alert at all
  const alertWorthy: string[] = []

  // 1. New high-priority action items from this scan
  if (newActionItemCount > 0) {
    const { data: recentItems } = await supabaseAdmin
      .from('action_items')
      .select('title, priority')
      .eq('source', 'email')
      .eq('priority', 'high')
      .gte('created_at', new Date(Date.now() - 3600000).toISOString()) // last hour
    if (recentItems && recentItems.length > 0) {
      alertWorthy.push(`New high-priority action items: ${recentItems.map(i => i.title).join(', ')}`)
    }
  }

  // 2. Stores significantly under target (<70%)
  const today = new Date().toISOString().split('T')[0]
  const { data: todaySales } = await supabaseAdmin
    .from('sales_data')
    .select('store_number, store_name, brand, net_sales')
    .eq('report_date', today)

  if (todaySales) {
    for (const sale of todaySales) {
      const target = sale.brand === 'wingstop' ? 8000 : 3000
      if (sale.net_sales && sale.net_sales < target * 0.7) {
        const pct = Math.round((sale.net_sales / target) * 100)
        alertWorthy.push(`${sale.store_name || sale.store_number} at ${pct}% of target ($${sale.net_sales.toLocaleString()})`)
      }
    }
  }

  if (alertWorthy.length === 0) return

  // Load preferences and check if user wants alerts suppressed
  const preferences = await getUserPreferences()
  const suppressAll = preferences.some(p =>
    p.toLowerCase().includes('no alert') || p.toLowerCase().includes('disable alert')
  )
  if (suppressAll) return

  // Check if high-priority only preference
  const highPriorityOnly = preferences.some(p =>
    p.toLowerCase().includes('only') && p.toLowerCase().includes('high-priority')
  )
  if (highPriorityOnly && newActionItemCount === 0) return

  // Guard against alert fatigue: no alert if one was sent in last 2 hours
  const convId = await getMainConversation()
  const { data: recentAlerts } = await supabaseAdmin
    .from('messages')
    .select('id')
    .eq('conversation_id', convId)
    .eq('role', 'assistant')
    .like('content', '⚡ **Alert**%')
    .gte('created_at', new Date(Date.now() - 2 * 3600000).toISOString())
    .limit(1)

  if (recentAlerts && recentAlerts.length > 0) return

  // Generate a short alert via Claude
  const response = await anthropic.messages.create({
    model: 'google/gemini-3.1-flash-lite-preview',
    max_tokens: 256,
    system: `Write a very short alert (2-3 sentences max) for Jason DeMayo. Be direct, no fluff. Use hyphens not em dashes.${preferences.length > 0 ? `\n\nUser preferences:\n${preferences.map(p => `- ${p}`).join('\n')}` : ''}`,
    messages: [{ role: 'user', content: `Alert items:\n${alertWorthy.map(a => `- ${a}`).join('\n')}` }],
    ...(BACKGROUND_EXTRA_BODY as any),
  })

  const alertText = response.content[0].type === 'text' ? response.content[0].text : ''
  if (!alertText) return

  await insertProactiveMessage(convId, `⚡ **Alert**\n\n${alertText}`)

  // Push notification
  await sendPushToAll('Alert', alertText.slice(0, 200), `/chat/${convId}`)
}

// --- Phase 3: Sales anomaly auto-trigger ---
// Detects stores significantly below their 4-week rolling average (same day of week)
async function maybeSpawnSalesAnomalyResearch(convId: string): Promise<void> {
  // Global cap
  const dailyCount = await getDailyAutoTriggerCount()
  if (dailyCount >= 5) return

  const now = new Date()
  const todayStr = now.toISOString().split('T')[0]
  const dayOfWeek = now.getDay()

  // Get today's Wingstop sales
  const { data: todaySales } = await supabaseAdmin
    .from('sales_data')
    .select('store_number, store_name, net_sales, brand')
    .eq('report_date', todayStr)
    .eq('brand', 'wingstop')

  if (!todaySales || todaySales.length === 0) return

  // Get the last 4 weeks of same-day-of-week sales for comparison
  const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 3600000).toISOString().split('T')[0]
  const { data: historicalSales } = await supabaseAdmin
    .from('sales_data')
    .select('store_number, net_sales, report_date')
    .eq('brand', 'wingstop')
    .gte('report_date', fourWeeksAgo)
    .lt('report_date', todayStr)

  if (!historicalSales || historicalSales.length === 0) return

  // Filter historical to same day of week and compute per-store averages
  const storeAverages: Record<string, { sum: number; count: number; name: string }> = {}
  for (const row of historicalSales) {
    const rowDay = new Date(row.report_date + 'T12:00:00Z').getUTCDay()
    if (rowDay !== dayOfWeek) continue
    if (!storeAverages[row.store_number]) {
      storeAverages[row.store_number] = { sum: 0, count: 0, name: row.store_number }
    }
    storeAverages[row.store_number].sum += row.net_sales || 0
    storeAverages[row.store_number].count++
  }

  // Find anomalies: today's sales 25%+ below rolling average
  const anomalies: { store_number: string; store_name: string; net_sales: number; average: number; pct_below: number }[] = []

  for (const sale of todaySales) {
    const avg = storeAverages[sale.store_number]
    if (!avg || avg.count < 2) continue // Need at least 2 weeks of data
    const rollingAvg = avg.sum / avg.count
    if (rollingAvg <= 0) continue
    const pctBelow = ((rollingAvg - (sale.net_sales || 0)) / rollingAvg) * 100
    if (pctBelow >= 25) {
      anomalies.push({
        store_number: sale.store_number,
        store_name: sale.store_name || sale.store_number,
        net_sales: sale.net_sales || 0,
        average: rollingAvg,
        pct_below: Math.round(pctBelow),
      })
    }
  }

  if (anomalies.length === 0) return

  for (const anomaly of anomalies) {
    // Per-store cooldown: one job per store per day
    const isLimited = await isAutoTriggerRateLimited('sales_anomaly', anomaly.store_number, 24 * 3600000)
    if (isLimited) continue

    // Recheck daily cap before each spawn
    const currentCount = await getDailyAutoTriggerCount()
    if (currentCount >= 5) break

    const prompt = `Sales anomaly detected: Store ${anomaly.store_number} (${anomaly.store_name}) is ${anomaly.pct_below}% below its 4-week rolling average for this day of week.

Today's sales: $${Math.round(anomaly.net_sales).toLocaleString()}
4-week rolling average (same day of week): $${Math.round(anomaly.average).toLocaleString()}

Please research this anomaly:
1. Search recent emails mentioning Store ${anomaly.store_number} or "${anomaly.store_name}" for any context (staffing issues, closures, problems)
2. Check action items and project context related to this store
3. Summarize what you find and suggest what might be causing the underperformance

Be specific - include any names, dates, or details from emails. If you find nothing relevant, say so clearly.`

    try {
      const job = await spawnBackgroundJob(
        convId,
        'analysis',
        prompt,
        'email_scan',
        { store_number: anomaly.store_number, pct_below: anomaly.pct_below }
      )
      await logAutoTrigger('sales_anomaly', anomaly.store_number, job.id, {
        store_name: anomaly.store_name,
        pct_below: anomaly.pct_below,
        net_sales: anomaly.net_sales,
        average: anomaly.average,
      })
      console.log(`Auto-trigger: spawned sales anomaly job ${job.id} for store ${anomaly.store_number} (${anomaly.pct_below}% below avg)`)
    } catch (e: any) {
      console.error(`Sales anomaly trigger failed for store ${anomaly.store_number}:`, e.message)
    }
  }
}

// Also support GET for Vercel Cron
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Forward to POST handler logic
  return POST(req)
}

async function extractPdfTextFromBuffer(buffer: Buffer): Promise<string> {
  const { extractPdfText } = await import('@/lib/pdf')
  const text = await extractPdfText(buffer)
  if (text && text.trim().length >= 100) return text
  // Fallback to AI OCR for scanned/complex PDFs
  console.log(`[email-scan] PDF text extraction got ${text?.length || 0} chars, falling back to OCR`)
  const { ocrPdfWithAI } = await import('@/lib/pdf')
  return ocrPdfWithAI(buffer)
}

function parseJsonSafe(text: string): any {
  let cleaned = text.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }
  const match = cleaned.match(/\{[\s\S]*\}/)
  return match ? JSON.parse(match[0]) : JSON.parse(cleaned)
}

async function parseWingstopSales(email: any) {
  try {
    // Find the "Forecast vs Actuals" PDF attachment
    const attachments: { filename: string; data: Buffer }[] = email.attachments || []
    console.log(`[wingstop-sales] Attachments: ${attachments.map(a => `${a.filename} (${a.data.length} bytes)`).join(', ') || 'none'}`)

    const forecastPdf = attachments.find((a: any) =>
      a.filename.toLowerCase().includes('forecast') || a.filename.toLowerCase().includes('actual')
    ) || attachments.find((a: any) => a.filename.toLowerCase().endsWith('.pdf'))

    if (!forecastPdf) {
      console.warn(`[wingstop-sales] No PDF attachments found, skipping`)
      return
    }

    console.log(`[wingstop-sales] Using PDF: ${forecastPdf.filename} (${forecastPdf.data.length} bytes)`)
    const pdfText = await extractPdfTextFromBuffer(forecastPdf.data)
    console.log(`[wingstop-sales] Extracted ${pdfText?.length || 0} chars of text`)
    if (!pdfText || pdfText.trim().length < 50) {
      console.warn(`[wingstop-sales] PDF "${forecastPdf.filename}" yielded insufficient text`)
      return
    }

    const response = await openrouterClient.chat.completions.create({
      model: BACKGROUND_MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: 'system',
          content: `Parse this Wingstop "Daily Forecast vs Actuals Summary" report. The PDF has columns in this order: Sales Forecast, Sales Actual, Sales Variance.

CRITICAL: Extract the "Sales Actual" column, NOT "Sales Forecast". These are adjacent columns and easy to confuse. The Sales Actual value is the SECOND numeric column after the date, not the first.

For each store section (identified by store number like 0326, 0451, etc.), find the most recent date row that has a non-zero "Sales Actual" value. Extract:
- net_sales = the "Sales Actual" value (SECOND column, not first)
- forecast_sales = the "Sales Forecast" value (FIRST column)
- budget_sales = the "Sales Budget" or "Budget" value if present, otherwise null
- report_date = the date from that row

Store numbers to extract: 326, 451, 895, 1870, 2067, 2428, 2262, 2289. Strip leading zeros.

Return JSON only:
{ "stores": [{ "store_number": "326", "store_name": "Coleman", "net_sales": 10070.84, "forecast_sales": 13120.00, "budget_sales": null, "report_date": "2026-03-15" }] }

If a store has no actual data yet (Sales Actual is 0.00 for all dates), omit it. Use YYYY-MM-DD for dates.`,
        },
        { role: 'user', content: pdfText.slice(0, 8000) },
      ],
      ...jsonBody(WINGSTOP_SALES_SCHEMA),
    } as any)

    const text = response.choices[0]?.message?.content || ''
    const parsed = parseJsonSafe(text)

    console.log(`[wingstop-sales] AI returned ${parsed.stores?.length || 0} stores`)
    if (parsed.stores) {
      for (const store of parsed.stores) {
        if (!store.report_date || !store.net_sales) continue
        console.log(`[wingstop-sales] Upserting store ${store.store_number} (${store.store_name}): $${store.net_sales} (forecast: ${store.forecast_sales ?? 'n/a'}, budget: ${store.budget_sales ?? 'n/a'}) on ${store.report_date}`)
        const { error: upsertError } = await supabaseAdmin.from('sales_data').upsert({
          report_date: store.report_date,
          brand: 'wingstop',
          store_number: store.store_number,
          store_name: store.store_name,
          net_sales: store.net_sales,
          forecast_sales: store.forecast_sales ?? null,
          budget_sales: store.budget_sales ?? null,
          raw_email_id: email.id,
        }, { onConflict: 'report_date,brand,store_number' })
        if (upsertError) console.error(`[wingstop-sales] Upsert failed for store ${store.store_number}: ${upsertError.message}`)
      }
    }
  } catch (e: any) {
    console.error(`[wingstop-sales] Failed: ${e.message}`)
  }
}

async function parseMrPicklesSales(email: any) {
  try {
    const attachments: { filename: string; data: Buffer }[] = email.attachments || []
    const pdf = attachments.find((a: any) => a.filename.toLowerCase().endsWith('.pdf'))

    if (!pdf) {
      console.warn(`Mr. Pickle's email ${email.id} has no PDF attachments, skipping sales parse`)
      return
    }

    const pdfText = await extractPdfTextFromBuffer(pdf.data)
    if (!pdfText || pdfText.trim().length < 50) {
      console.warn(`Mr. Pickle's PDF "${pdf.filename}" yielded no text`)
      return
    }

    const response = await openrouterClient.chat.completions.create({
      model: BACKGROUND_MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: 'system',
          content: `Parse this Mr. Pickle's Daily Sales Report. Extract the Net Sales total (from the Net Sales section, not Gross Sales) for each store. The report date is in the header (Date: MM/DD/YYYY).

Stores to extract: 405 (Fresno / Blackstone) and 1008 (Van Nuys / Sepulveda). A single report may cover one or both stores.

Return JSON only:
{ "stores": [{ "store_number": "405", "store_name": "Fresno", "net_sales": 1234.56, "report_date": "2026-01-15" }] }

Use YYYY-MM-DD for dates.`,
        },
        { role: 'user', content: pdfText.slice(0, 8000) },
      ],
      ...jsonBody(MR_PICKLES_SALES_SCHEMA),
    } as any)

    const text = response.choices[0]?.message?.content || ''
    const parsed = parseJsonSafe(text)

    if (parsed.stores) {
      for (const store of parsed.stores) {
        if (!store.report_date || !store.net_sales) continue
        const { error: upsertError } = await supabaseAdmin.from('sales_data').upsert({
          report_date: store.report_date,
          brand: 'mrpickles',
          store_number: store.store_number,
          store_name: store.store_name,
          net_sales: store.net_sales,
          raw_email_id: email.id,
        }, { onConflict: 'report_date,brand,store_number' })
        if (upsertError) console.error(`[mrpickles-sales] Upsert failed for store ${store.store_number}: ${upsertError.message}`)
      }
    }
  } catch (e) {
    console.error("Failed to parse Mr. Pickle's sales:", e)
  }
}
