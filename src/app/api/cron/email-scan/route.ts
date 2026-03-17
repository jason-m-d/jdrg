import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchEmails } from '@/lib/gmail'
import { getMainConversation, insertProactiveMessage, getUserPreferences } from '@/lib/proactive'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const WINGSTOP_STORES = ['326', '451', '895', '1870', '2067', '2428', '2262', '2289']

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

Return JSON:
{
  "action_items": [{"title": "...", "description": "...", "priority": "high|medium|low", "due_date": null, "source_snippet": "..."}],
  "updates": [{"item_id": "uuid", "description": "updated description", "priority": "high|medium|low", "due_date": "2026-01-20"}]
}

Return {"action_items": [], "updates": []} if nothing qualifies.`

export async function POST(req: NextRequest) {
  // Validate secret (cron or manual)
  const cronSecret = req.headers.get('x-cron-secret') || req.headers.get('authorization')
  if (cronSecret !== process.env.CRON_SECRET && cronSecret !== 'manual' && cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let totalProcessed = 0
  let totalItems = 0

  // Get all connected accounts
  const { data: accounts } = await supabaseAdmin.from('gmail_tokens').select('account')
  if (!accounts || accounts.length === 0) {
    return NextResponse.json({ message: 'No accounts connected', emails_processed: 0, action_items_found: 0 })
  }

  // Load existing action items for dedup
  const { data: existingItems } = await supabaseAdmin
    .from('action_items')
    .select('id, title, description, status, priority, due_date')
    .in('status', ['pending', 'approved'])
    .order('created_at', { ascending: false })
    .limit(30)

  const existingItemsList = (existingItems || [])
    .map((item: any) => `- [${item.id}] "${item.title}" (${item.status}, ${item.priority})${item.due_date ? ` due: ${item.due_date}` : ''}`)
    .join('\n') || '(none)'

  const systemPrompt = EMAIL_EXTRACTION_PROMPT.replace('{EXISTING_ITEMS}', existingItemsList)

  for (const { account } of accounts) {
    try {
      // Get last scan time
      const { data: scan } = await supabaseAdmin
        .from('email_scans')
        .select('last_scanned_at')
        .eq('account', account)
        .single()

      const since = scan?.last_scanned_at ? new Date(scan.last_scanned_at) : new Date(Date.now() - 3600000) // default 1 hour ago

      const emails = await fetchEmails(account, since)
      let itemsFound = 0

      for (const email of emails) {
        // Check for sales emails
        if (email.subject.includes('NBO Daily Reports') && email.subject.includes('DeMayo')) {
          await parseWingstopSales(email)
        } else if (email.subject.includes('[MP]') && email.subject.includes('Daily Sales')) {
          await parseMrPicklesSales(email)
        }

        // Extract action items via Claude
        try {
          const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1024,
            system: systemPrompt,
            messages: [{
              role: 'user',
              content: `From: ${email.from}\nSubject: ${email.subject}\n\n${email.body.slice(0, 3000)}`,
            }],
          })

          const text = response.content[0].type === 'text' ? response.content[0].text : ''
          let parsed: any
          try {
            let cleaned = text.trim()
            if (cleaned.startsWith('```')) {
              cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
            }
            const match = cleaned.match(/\{[\s\S]*\}/)
            parsed = match ? JSON.parse(match[0]) : JSON.parse(cleaned)
          } catch {
            console.error('Failed to parse email extraction response:', text.slice(0, 200))
            continue
          }

          // Handle new action items
          if (parsed.action_items?.length > 0) {
            const isHighPriority = email.from.includes('@wingstop.com') ||
              WINGSTOP_STORES.some(s => email.body.includes(s) || email.subject.includes(s))

            for (const item of parsed.action_items) {
              await supabaseAdmin.from('action_items').insert({
                title: item.title,
                description: item.description,
                source: 'email',
                source_id: email.id,
                source_snippet: item.source_snippet || email.subject,
                priority: isHighPriority ? 'high' : (item.priority || 'medium'),
                due_date: item.due_date || null,
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
        } catch (e) {
          console.error(`Failed to process email ${email.id}:`, e)
        }
      }

      totalProcessed += emails.length
      totalItems += itemsFound

      // Update scan record
      await supabaseAdmin.from('email_scans').upsert({
        account,
        last_scanned_at: new Date().toISOString(),
        emails_processed: emails.length,
        action_items_found: itemsFound,
      }, { onConflict: 'account' })

    } catch (e) {
      console.error(`Failed to scan ${account}:`, e)
    }
  }

  // Post-scan alerts: check if anything noteworthy warrants an alert
  try {
    await maybeGenerateAlert(totalItems)
  } catch (e) {
    console.error('Alert generation failed:', e)
  }

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
    model: 'claude-sonnet-4-20250514',
    max_tokens: 256,
    system: `Write a very short alert (2-3 sentences max) for Jason DeMayo. Be direct, no fluff. Use hyphens not em dashes.${preferences.length > 0 ? `\n\nUser preferences:\n${preferences.map(p => `- ${p}`).join('\n')}` : ''}`,
    messages: [{ role: 'user', content: `Alert items:\n${alertWorthy.map(a => `- ${a}`).join('\n')}` }],
  })

  const alertText = response.content[0].type === 'text' ? response.content[0].text : ''
  if (!alertText) return

  await insertProactiveMessage(convId, `⚡ **Alert**\n\n${alertText}`)
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

async function parseWingstopSales(email: any) {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: `Parse this Wingstop NBO Daily Report email. Extract net sales for each store. Return JSON: { "stores": [{ "store_number": "326", "store_name": "...", "net_sales": 1234.56 }], "report_date": "2026-01-15" }. Store numbers to look for: 326, 451, 895, 1870, 2067, 2428, 2262, 2289.`,
      messages: [{ role: 'user', content: email.body.slice(0, 5000) }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const parsed = JSON.parse(text)

    if (parsed.stores) {
      for (const store of parsed.stores) {
        await supabaseAdmin.from('sales_data').upsert({
          report_date: parsed.report_date,
          brand: 'wingstop',
          store_number: store.store_number,
          store_name: store.store_name,
          net_sales: store.net_sales,
          raw_email_id: email.id,
        }, { onConflict: 'report_date,brand,store_number' })
      }
    }
  } catch (e) {
    console.error('Failed to parse Wingstop sales:', e)
  }
}

async function parseMrPicklesSales(email: any) {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: `Parse this Mr. Pickle's Daily Sales Report email. Extract net sales for stores 405 (Fresno) and 1008 (Van Nuys). Return JSON: { "stores": [{ "store_number": "405", "store_name": "Fresno", "net_sales": 1234.56 }], "report_date": "2026-01-15" }.`,
      messages: [{ role: 'user', content: email.body.slice(0, 5000) }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const parsed = JSON.parse(text)

    if (parsed.stores) {
      for (const store of parsed.stores) {
        await supabaseAdmin.from('sales_data').upsert({
          report_date: parsed.report_date,
          brand: 'mrpickles',
          store_number: store.store_number,
          store_name: store.store_name,
          net_sales: store.net_sales,
          raw_email_id: email.id,
        }, { onConflict: 'report_date,brand,store_number' })
      }
    }
  } catch (e) {
    console.error("Failed to parse Mr. Pickle's sales:", e)
  }
}
