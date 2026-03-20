import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getMainConversation, insertProactiveMessage } from '@/lib/proactive'
import { sendPushToAll } from '@/lib/push'
import { spawnBackgroundJob, isAutoTriggerRateLimited, getDailyAutoTriggerCount, logAutoTrigger } from '@/lib/background-jobs'
import { openrouterClient } from '@/lib/openrouter'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret') || req.headers.get('authorization')
  if (cronSecret !== process.env.CRON_SECRET && cronSecret !== 'manual' && cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const convId = await getMainConversation()

  // Anti-spam: skip if a nudge was sent in the last 2 hours
  const { data: recentNudges } = await supabaseAdmin
    .from('messages')
    .select('id')
    .eq('conversation_id', convId)
    .eq('role', 'assistant')
    .like('content', '%**Nudge**%')
    .gte('created_at', new Date(Date.now() - 2 * 3600000).toISOString())
    .limit(1)

  if (recentNudges && recentNudges.length > 0) {
    return NextResponse.json({ message: 'Skipped — nudge sent recently', nudged: false })
  }

  const now = new Date()
  const tomorrow = new Date(now.getTime() + 24 * 3600000).toISOString().split('T')[0]

  // Query all candidates in parallel
  const [
    { data: staleItems },
    { data: dueItems },
    { data: openCommitments },
    { data: unansweredInbound },
    { data: unansweredOutbound },
  ] = await Promise.all([
    // 1. Stale action items: pending/approved, updated 5+ days ago, not nudged in 24h
    supabaseAdmin
      .from('action_items')
      .select('id, title, priority, due_date, updated_at')
      .in('status', ['pending', 'approved'])
      .lt('updated_at', new Date(now.getTime() - 5 * 24 * 3600000).toISOString())
      .or(`last_nudged_at.is.null,last_nudged_at.lt.${new Date(now.getTime() - 24 * 3600000).toISOString()}`)
      .order('priority', { ascending: true })
      .limit(10),

    // 2. Due/overdue action items: due_date <= tomorrow
    supabaseAdmin
      .from('action_items')
      .select('id, title, priority, due_date')
      .in('status', ['pending', 'approved'])
      .not('due_date', 'is', null)
      .lte('due_date', tomorrow)
      .order('due_date', { ascending: true })
      .limit(10),

    // 3. Open commitments due soon
    supabaseAdmin
      .from('commitments')
      .select('id, commitment_text, target_date, related_contact')
      .eq('status', 'open')
      .not('target_date', 'is', null)
      .lte('target_date', tomorrow)
      .order('target_date', { ascending: true })
      .limit(10),

    // 4. Unanswered inbound emails (2+ days old)
    supabaseAdmin
      .from('email_threads')
      .select('id, subject, last_sender, last_message_date')
      .eq('direction', 'inbound')
      .eq('needs_response', true)
      .eq('response_detected', false)
      .lt('last_message_date', new Date(now.getTime() - 2 * 24 * 3600000).toISOString())
      .order('last_message_date', { ascending: true })
      .limit(10),

    // 5. Unanswered outbound (Jason sent, no reply in 3+ days)
    supabaseAdmin
      .from('email_threads')
      .select('id, subject, last_sender, last_message_date')
      .eq('direction', 'outbound')
      .eq('response_detected', false)
      .lt('last_message_date', new Date(now.getTime() - 3 * 24 * 3600000).toISOString())
      .order('last_message_date', { ascending: true })
      .limit(10),
  ])

  // Auto-expire old commitments (target_date 7+ days past)
  const expiryCutoff = new Date(now.getTime() - 7 * 24 * 3600000).toISOString().split('T')[0]
  await supabaseAdmin
    .from('commitments')
    .update({ status: 'expired' })
    .eq('status', 'open')
    .not('target_date', 'is', null)
    .lt('target_date', expiryCutoff)

  // Build candidate list
  const candidates: string[] = []

  // Check WTD forecast comparison (Tue-Fri only)
  const dayOfWeek = now.getDay() // 0=Sun, 1=Mon...
  if (dayOfWeek >= 2 && dayOfWeek <= 5) {
    try {
      const forecastAlerts = await checkSalesForecast(now)
      for (const alert of forecastAlerts) {
        candidates.push(alert)
      }
    } catch (e: any) {
      console.error('Forecast check failed:', e.message)
    }
  }

  // Check for decision follow-ups
  try {
    const decisionAlerts = await checkDecisionFollowups()
    for (const alert of decisionAlerts) {
      candidates.push(alert)
    }
  } catch (e: any) {
    console.error('Decision follow-up check failed:', e.message)
  }

  for (const item of (dueItems || [])) {
    const overdue = item.due_date && item.due_date < now.toISOString().split('T')[0]
    candidates.push(`[ACTION ITEM - ${overdue ? 'OVERDUE' : 'DUE SOON'}] "${item.title}" (${item.priority} priority, due ${item.due_date})`)
  }

  for (const item of (staleItems || [])) {
    // Skip if already in due items
    if (dueItems?.some(d => d.id === item.id)) continue
    const days = Math.floor((now.getTime() - new Date(item.updated_at).getTime()) / (24 * 3600000))
    candidates.push(`[STALE ACTION ITEM] "${item.title}" (${item.priority} priority, no activity for ${days} days)`)
  }

  for (const c of (openCommitments || [])) {
    const overdue = c.target_date && c.target_date < now.toISOString().split('T')[0]
    candidates.push(`[COMMITMENT - ${overdue ? 'OVERDUE' : 'DUE SOON'}] "${c.commitment_text}"${c.related_contact ? ` (re: ${c.related_contact})` : ''} — target: ${c.target_date}`)
  }

  for (const thread of (unansweredInbound || [])) {
    const days = Math.floor((now.getTime() - new Date(thread.last_message_date).getTime()) / (24 * 3600000))
    candidates.push(`[UNANSWERED EMAIL] From ${thread.last_sender}: "${thread.subject}" (${days} days ago, no reply)`)
  }

  for (const thread of (unansweredOutbound || [])) {
    const days = Math.floor((now.getTime() - new Date(thread.last_message_date).getTime()) / (24 * 3600000))
    candidates.push(`[NO REPLY RECEIVED] You emailed about "${thread.subject}" ${days} days ago — no response yet`)
  }

  if (candidates.length === 0) {
    return NextResponse.json({ message: 'Nothing to nudge', nudged: false })
  }

  // Generate nudge message via AI — pick top 3-5
  const response = await openrouterClient.chat.completions.create({
    model: 'google/gemini-3.1-flash-lite-preview',
    max_tokens: 400,
    messages: [
      { role: 'system', content: `You're Crosby, Jason DeMayo's AI assistant. Write a brief, direct nudge message about things that need his attention. Pick the top 3-5 most important items from the list. Be specific — include names, dates, subjects. Use hyphens not em dashes. Keep it under 200 words. Start with a brief one-liner, then bullet points. Don't be annoying or preachy — just surface what matters.\n\nToday is ${now.toISOString().split('T')[0]}.` },
      { role: 'user', content: `Items needing attention:\n${candidates.join('\n')}` },
    ],
    ...({ models: ['google/gemini-3.1-flash-lite-preview', 'google/gemini-3-flash-preview'], provider: { sort: 'price' } } as any),
  } as any)

  const nudgeText = response.choices[0]?.message?.content || ''
  if (!nudgeText) {
    return NextResponse.json({ message: 'AI returned empty nudge', nudged: false })
  }

  await insertProactiveMessage(convId, `📌 Nudge\n\n${nudgeText}`, 'nudge')
  await sendPushToAll('Nudge', nudgeText.slice(0, 200), `/chat/${convId}`)

  // Update last_nudged_at on all candidate action items
  const allItemIds = [
    ...(staleItems || []).map(i => i.id),
    ...(dueItems || []).map(i => i.id),
  ]
  if (allItemIds.length > 0) {
    await supabaseAdmin
      .from('action_items')
      .update({ last_nudged_at: now.toISOString() })
      .in('id', allItemIds)
  }

  // Fire-and-forget: analyze dismissal patterns (weekly)
  analyzeDismissalPatterns(convId).catch(e => console.error('Dismissal analysis failed:', e))

  // Fire-and-forget: spawn deadline research for items due in next 3 days
  maybeSpawnDeadlineResearch(convId, dueItems || [], openCommitments || [])
    .catch(e => console.error('Deadline research spawn failed:', e))

  return NextResponse.json({
    message: `Nudge sent with ${candidates.length} candidates`,
    nudged: true,
    candidate_count: candidates.length,
  })
}

// Also support GET for Vercel Cron
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return POST(req)
}

// --- Feature 2b: Week-to-date forecast comparison ---
async function checkSalesForecast(now: Date): Promise<string[]> {
  const alerts: string[] = []

  // Get Monday of current week
  const dayOfWeek = now.getDay()
  const monday = new Date(now)
  monday.setDate(monday.getDate() - (dayOfWeek - 1))
  const mondayStr = monday.toISOString().split('T')[0]
  const todayStr = now.toISOString().split('T')[0]

  // Get all sales data for this week that have forecast data
  const { data: weekSales } = await supabaseAdmin
    .from('sales_data')
    .select('store_number, store_name, net_sales, forecast_sales, report_date')
    .eq('brand', 'wingstop')
    .gte('report_date', mondayStr)
    .lte('report_date', todayStr)
    .not('forecast_sales', 'is', null)

  if (!weekSales || weekSales.length === 0) return alerts

  // Group by store
  const byStore: Record<string, { actual: number; forecast: number; name: string; days: number }> = {}
  for (const row of weekSales) {
    const key = row.store_number
    if (!byStore[key]) byStore[key] = { actual: 0, forecast: 0, name: row.store_name || key, days: 0 }
    byStore[key].actual += row.net_sales || 0
    byStore[key].forecast += row.forecast_sales || 0
    byStore[key].days++
  }

  // Days remaining in week (Sat = end of week for restaurants)
  const daysRemaining = 6 - dayOfWeek // Sat(6) - today

  for (const [storeNum, data] of Object.entries(byStore)) {
    if (data.days < 2 || daysRemaining < 2) continue // Need 2+ days data and 2+ days remaining
    if (data.forecast === 0) continue

    const pctOfForecast = (data.actual / data.forecast) * 100
    if (pctOfForecast < 85) { // 15%+ below
      const gap = data.forecast - data.actual
      alerts.push(`[FORECAST ALERT] ${data.name} (#${storeNum}) is ${Math.round(100 - pctOfForecast)}% below WTD forecast ($${Math.round(data.actual).toLocaleString()} actual vs $${Math.round(data.forecast).toLocaleString()} forecast, $${Math.round(gap).toLocaleString()} gap with ${daysRemaining} days left)`)
    }
  }

  return alerts
}

// --- Feature 3b: Dismissal pattern analysis ---
async function analyzeDismissalPatterns(convId: string) {
  // Weekly gate: check if we already ran this week
  const { data: lastRun } = await supabaseAdmin
    .from('user_state')
    .select('value')
    .eq('key', 'last_dismissal_analysis')
    .single()

  if (lastRun?.value?.timestamp) {
    const elapsed = Date.now() - new Date(lastRun.value.timestamp).getTime()
    if (elapsed < 7 * 24 * 3600000) return // Less than 7 days
  }

  // Get dismissed items from last 30 days with reasons
  const { data: dismissed } = await supabaseAdmin
    .from('action_items')
    .select('title, description, source, source_snippet, dismissal_reason')
    .eq('status', 'dismissed')
    .gte('updated_at', new Date(Date.now() - 30 * 24 * 3600000).toISOString())
    .order('updated_at', { ascending: false })
    .limit(50)

  if (!dismissed || dismissed.length < 5) return // Need at least 5 items to find patterns

  const ruleSchema = {
    type: 'object',
    properties: {
      rules: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            rule: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['rule', 'reason'],
          additionalProperties: false,
        },
      },
    },
    required: ['rules'],
    additionalProperties: false,
  }

  const response = await openrouterClient.chat.completions.create({
    model: 'google/gemini-3.1-flash-lite-preview',
    max_tokens: 400,
    messages: [
      { role: 'system', content: `Analyze these dismissed action items and identify 0-3 patterns. A pattern is a category or type of item that Jason consistently dismisses. Only suggest rules if there's a clear pattern (3+ similar dismissals).

Each rule should be specific enough to apply automatically. Examples:
- "Never flag automated system notifications from Wingstop's NBO portal"
- "Don't create action items for routine vendor invoice emails"
- "Skip newsletter-style emails from franchise associations"

Return JSON: {"rules": [{"rule": "...", "reason": "based on N dismissed items about X"}]}
Return {"rules": []} if no clear patterns found.` },
      { role: 'user', content: JSON.stringify(dismissed.map(d => ({
        title: d.title,
        source: d.source,
        snippet: d.source_snippet?.slice(0, 200),
        reason: d.dismissal_reason,
      }))) },
    ],
    ...({
      models: ['google/gemini-3.1-flash-lite-preview', 'google/gemini-3-flash-preview'],
      provider: { sort: 'price' },
      plugins: [{ id: 'response-healing' }],
      response_format: { type: 'json_schema', json_schema: { name: 'response', strict: true, schema: ruleSchema } },
    } as any),
  } as any)

  const text = response.choices[0]?.message?.content || ''
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    return
  }

  if (!parsed.rules || parsed.rules.length === 0) {
    // Update gate even if no rules found
    await supabaseAdmin.from('user_state').upsert({
      key: 'last_dismissal_analysis',
      value: { timestamp: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })
    return
  }

  // Insert new rules
  const newRules: string[] = []
  for (const r of parsed.rules) {
    if (!r.rule) continue
    await supabaseAdmin.from('training_rules').insert({
      rule: r.rule,
      category: 'never_flag',
      is_active: true,
    })
    newRules.push(r.rule)
  }

  // Update gate
  await supabaseAdmin.from('user_state').upsert({
    key: 'last_dismissal_analysis',
    value: { timestamp: new Date().toISOString(), rules_created: newRules.length },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' })

  // Announce to main conversation
  if (newRules.length > 0) {
    const announcement = `🧠 **Learning Update**\n\nI analyzed your recent dismissals and learned ${newRules.length} new pattern${newRules.length > 1 ? 's' : ''}:\n${newRules.map(r => `- ${r}`).join('\n')}\n\nI'll stop flagging items like these going forward. Let me know if any of these rules are wrong.`
    await insertProactiveMessage(convId, announcement)
  }
}

// --- Feature 4d: Decision follow-ups in nudge ---
async function checkDecisionFollowups(): Promise<string[]> {
  const alerts: string[] = []

  // Get recent decisions (last 14 days)
  const { data: decisions } = await supabaseAdmin
    .from('decisions')
    .select('decision_text, context, decided_at')
    .gte('decided_at', new Date(Date.now() - 14 * 24 * 3600000).toISOString())
    .order('decided_at', { ascending: false })
    .limit(20)

  if (!decisions || decisions.length === 0) return alerts

  const timeKeywords = ['deadline', 'expires', 'by ', 'before', 'trial period', 'end of', 'this week', 'next week', 'by friday', 'by monday', 'until']

  for (const d of decisions) {
    const combined = `${d.decision_text} ${d.context || ''}`.toLowerCase()
    const hasTimeConstraint = timeKeywords.some(kw => combined.includes(kw))
    if (hasTimeConstraint) {
      const daysAgo = Math.floor((Date.now() - new Date(d.decided_at).getTime()) / (24 * 3600000))
      alerts.push(`[DECISION FOLLOW-UP] "${d.decision_text}" (decided ${daysAgo} day${daysAgo !== 1 ? 's' : ''} ago)${d.context ? ` - context: ${d.context.slice(0, 100)}` : ''}`)
    }
  }

  return alerts
}

// --- Phase 3: Auto-trigger deadline research ---
async function maybeSpawnDeadlineResearch(
  convId: string,
  dueItems: { id: string; title: string; priority: string; due_date: string | null }[],
  openCommitments: { id: string; commitment_text: string; target_date: string | null; related_contact: string | null }[]
): Promise<void> {
  // Global cap: max 5 auto-triggered jobs per day
  const dailyCount = await getDailyAutoTriggerCount()
  if (dailyCount >= 5) {
    console.log('Auto-trigger: daily cap reached, skipping deadline research')
    return
  }

  const now = new Date()
  const threeDaysOut = new Date(now.getTime() + 3 * 24 * 3600000).toISOString().split('T')[0]
  const todayStr = now.toISOString().split('T')[0]

  // Find items due within 3 days
  const urgentItems = dueItems.filter(item => {
    if (!item.due_date) return false
    return item.due_date >= todayStr && item.due_date <= threeDaysOut
  })

  const urgentCommitments = openCommitments.filter(c => {
    if (!c.target_date) return false
    return c.target_date >= todayStr && c.target_date <= threeDaysOut
  })

  if (urgentItems.length === 0 && urgentCommitments.length === 0) return

  // Check cooldown: only one deadline research job per 24 hours
  const isLimited = await isAutoTriggerRateLimited('deadline_research', null, 24 * 3600000)
  if (isLimited) {
    console.log('Auto-trigger: deadline_research on cooldown, skipping')
    return
  }

  // Build a combined prompt for all urgent items
  const itemDescriptions = [
    ...urgentItems.map(i => `- Action item: "${i.title}" (${i.priority} priority, due ${i.due_date})`),
    ...urgentCommitments.map(c => `- Commitment: "${c.commitment_text}"${c.related_contact ? ` (re: ${c.related_contact})` : ''} due ${c.target_date}`),
  ].join('\n')

  const prompt = `Research and compile a briefing for these upcoming deadlines (due within 3 days):

${itemDescriptions}

For each item:
1. Search emails for any recent correspondence about this topic
2. Check project context and documents for relevant background
3. Summarize what you know: current status, key contacts, important details, and what Jason needs to do next

Format as a clear briefing with a section per item. Be specific - include names, numbers, dates. Focus on what's actionable.`

  try {
    const job = await spawnBackgroundJob(
      convId,
      'research',
      prompt,
      'nudge_cron',
      { item_count: urgentItems.length + urgentCommitments.length }
    )

    await logAutoTrigger('deadline_research', null, job.id, {
      item_count: urgentItems.length + urgentCommitments.length,
    })

    console.log(`Auto-trigger: spawned deadline research job ${job.id} for ${urgentItems.length + urgentCommitments.length} items`)
  } catch (e: any) {
    console.error('Auto-trigger deadline research failed:', e.message)
  }
}
