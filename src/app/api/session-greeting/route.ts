import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase'
import { getUserPreferences } from '@/lib/proactive'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL })

type SessionType = 'morning' | 'midday' | 'afternoon' | 'evening' | 'weekend' | 'continuation'

function classifySession(now: Date, lastGreetingAt: string | null): SessionType {
  const day = now.getDay()
  if (day === 0 || day === 6) return 'weekend'

  if (lastGreetingAt) {
    const elapsed = now.getTime() - new Date(lastGreetingAt).getTime()
    if (elapsed < 2 * 60 * 60 * 1000) return 'continuation' // < 2 hours
  }

  const hour = now.getHours()
  if (hour < 11) return 'morning'
  if (hour < 15) return 'midday'
  if (hour < 18) return 'afternoon'
  return 'evening'
}

export async function GET(req: NextRequest) {
  const itemsOnly = req.nextUrl.searchParams.get('items_only') === '1'
  try {
    // Check debounce
    const { data: greetingState } = await supabaseAdmin
      .from('user_state')
      .select('value')
      .eq('key', 'last_greeting_at')
      .single()

    const lastGreetingAt = greetingState?.value?.timestamp || null
    const cachedGreeting = greetingState?.value?.greeting_text || null
    const cachedItems = greetingState?.value?.surfaced_items || null
    if (itemsOnly && lastGreetingAt) {
      const elapsed = Date.now() - new Date(lastGreetingAt).getTime()
      if (elapsed < 10 * 60 * 1000) {
        // Check if user has sent any messages since the greeting
        const { data: conv } = await supabaseAdmin
          .from('conversations')
          .select('id')
          .is('project_id', null)
          .order('updated_at', { ascending: false })
          .limit(1)
          .single()
        if (conv) {
          const { count } = await supabaseAdmin
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('conversation_id', conv.id)
            .eq('role', 'user')
            .gte('created_at', lastGreetingAt)
          if ((count || 0) === 0 && cachedGreeting) {
            // No new messages - return cached greeting
            return NextResponse.json({
              cached: true,
              greeting_text: cachedGreeting,
              surfaced_items: cachedItems || [],
            })
          }
        }
        return NextResponse.json({ skip: true })
      }
    }

    // Get Pacific time
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
    const sessionType = classifySession(now, lastGreetingAt)

    // Gather context in parallel
    const [
      actionItemsResult,
      recentlyCompletedResult,
      emailScansResult,
      recentMessagesResult,
      briefingCheckResult,
      salesResult,
      preferences,
      dashboardCardsResult,
      notificationRulesResult,
      projectsResult,
    ] = await Promise.all([
      // Active action items (excluding snoozed)
      supabaseAdmin
        .from('action_items')
        .select('*')
        .in('status', ['pending', 'approved'])
        .or('snoozed_until.is.null,snoozed_until.lte.' + new Date().toISOString())
        .order('priority')
        .order('created_at', { ascending: false })
        .limit(30),
      // Recently completed (last 24h)
      supabaseAdmin
        .from('action_items')
        .select('title, updated_at')
        .eq('status', 'completed')
        .gte('updated_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('updated_at', { ascending: false })
        .limit(10),
      // Email scan stats
      supabaseAdmin
        .from('email_scans')
        .select('*')
        .order('last_scanned_at', { ascending: false })
        .limit(3),
      // Last 5 messages from main conversation
      supabaseAdmin
        .from('conversations')
        .select('id')
        .is('project_id', null)
        .order('updated_at', { ascending: false })
        .limit(1)
        .single()
        .then(async ({ data: conv }) => {
          if (!conv) return []
          const { data: msgs } = await supabaseAdmin
            .from('messages')
            .select('role, content, created_at')
            .eq('conversation_id', conv.id)
            .order('created_at', { ascending: false })
            .limit(5)
          return (msgs || []).reverse()
        }),
      // Check if morning briefing exists today
      supabaseAdmin
        .from('messages')
        .select('id')
        .like('content', '☀️ **Morning Briefing%')
        .gte('created_at', new Date().toISOString().split('T')[0] + 'T00:00:00Z')
        .limit(1),
      // Today's sales
      supabaseAdmin
        .from('sales_data')
        .select('store_number, store_name, brand, net_sales')
        .eq('report_date', new Date().toISOString().split('T')[0]),
      // User preferences
      getUserPreferences(),
      // Dashboard cards
      supabaseAdmin
        .from('dashboard_cards')
        .select('title, content, card_type, updated_at')
        .eq('is_active', true)
        .order('position'),
      // Active notification rules
      supabaseAdmin
        .from('notification_rules')
        .select('description, is_active')
        .eq('is_active', true),
      // Active projects
      supabaseAdmin
        .from('projects')
        .select('name')
        .order('updated_at', { ascending: false })
        .limit(5),
    ])

    const actionItems = actionItemsResult.data || []
    const recentlyCompleted = recentlyCompletedResult.data || []
    const emailScans = emailScansResult.data || []
    const recentMessages = recentMessagesResult || []
    const hasBriefingToday = (briefingCheckResult.data || []).length > 0
    const salesData = salesResult.data || []
    const dashboardCards = dashboardCardsResult.data || []
    const notificationRules = notificationRulesResult.data || []
    const recentProjects = projectsResult.data || []

    // Identify stale items (pending/approved, no due date, created > 14 days ago, not surfaced in > 7 days)
    const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const staleItems = actionItems.filter(item =>
      !item.due_date &&
      new Date(item.created_at).getTime() < fourteenDaysAgo &&
      (!item.last_surfaced_at || new Date(item.last_surfaced_at).getTime() < sevenDaysAgo)
    )

    // Classify items for surfacing
    const overdue = actionItems.filter(i => i.due_date && new Date(i.due_date) < new Date())
    const dueToday = actionItems.filter(i => i.due_date && i.due_date.startsWith(new Date().toISOString().split('T')[0]))
    const highPriority = actionItems.filter(i => i.priority === 'high' && !overdue.includes(i) && !dueToday.includes(i))

    // Items to surface: overdue + due today + high priority (deduped)
    const surfacedSet = new Set<string>()
    const surfacedItems: typeof actionItems = []
    for (const item of [...overdue, ...dueToday, ...highPriority]) {
      if (!surfacedSet.has(item.id)) {
        surfacedSet.add(item.id)
        surfacedItems.push(item)
      }
    }

    // Also add recently created items not yet surfaced (new since last greeting)
    if (lastGreetingAt) {
      for (const item of actionItems) {
        if (!surfacedSet.has(item.id) && new Date(item.created_at) > new Date(lastGreetingAt)) {
          surfacedSet.add(item.id)
          surfacedItems.push(item)
        }
      }
    }

    // Detect first session ever
    const isFirstSession = !lastGreetingAt && recentMessages.length === 0

    // Fast path: return items only without AI call
    if (itemsOnly) {
      return NextResponse.json({
        surfaced_items: surfacedItems.map(i => ({
          id: i.id,
          title: i.title,
          priority: i.priority,
          context: overdue.includes(i) ? 'overdue' : dueToday.includes(i) ? 'due_today' : 'active',
        })),
      })
    }

    // Build the prompt
    const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    const dayStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

    let prompt = `Generate a brief session greeting for Jason DeMayo, CEO of DeMayo Restaurant Group (8 Wingstop locations) and Hungry Hospitality Group (2 Mr. Pickle's locations).

Current time: ${timeStr} Pacific, ${dayStr}
Session type: ${sessionType}
${isFirstSession ? 'This is Jason\'s FIRST TIME using the app. Give a warm but brief intro.' : ''}
${hasBriefingToday ? 'A morning briefing was already generated today - do NOT repeat sales or email data.' : ''}

TONE: Casual, direct, accountable. Like a sharp chief of staff who knows the business. Use hyphens, not em dashes.

FORMATTING (critical):
- Write 2-4 sentences ONLY. This is a brief narrative summary, NOT a list.
- Do NOT use bullet points. Do NOT list every item. The action items are displayed separately in the UI.
- Use **bold** sparingly for 1-2 key highlights (a number, a name, a deadline).
- Summarize the overall state: what's the vibe? Busy day? Quiet? Fires to put out? Things winding down?
- If there are urgent items, mention 1-2 by name naturally in the prose. Don't enumerate them all.
- Example: "Busy one today - **3 things** need your attention before lunch, mostly around the #1008 sale. The Fresno complaint is escalating too."
- Example quiet: "Clean slate this morning. Nothing urgent, just a few things simmering in the background."
`

    if (sessionType === 'morning' && !hasBriefingToday && salesData.length > 0) {
      prompt += `\nSales data available:\n${salesData.map(s => `- ${s.store_name} (#${s.store_number}): $${s.net_sales?.toLocaleString()}`).join('\n')}\n`
    }

    if (sessionType === 'evening') {
      prompt += `\nIt's evening - only mention urgent/overdue items. Otherwise keep it light: "Nothing urgent. Go relax."\n`
    }

    if (sessionType === 'weekend') {
      prompt += `\nIt's the weekend - only surface truly urgent items. Keep it minimal.\n`
    }

    if (sessionType === 'continuation') {
      if (surfacedItems.length === 0 && recentlyCompleted.length === 0) {
        return NextResponse.json({ skip: true })
      }
      prompt += `\nThis is a continuation session (Jason was here recently). Only mention what's new or changed since then. Be brief.\n`
    }

    if (surfacedItems.length > 0) {
      prompt += `\nAction items (these will be shown separately in the UI - do NOT list them, just reference 1-2 key ones naturally):\n${surfacedItems.slice(0, 5).map(i => {
        let context = `[${i.priority}]`
        if (overdue.includes(i)) context += ' OVERDUE'
        if (dueToday.includes(i)) context += ' DUE TODAY'
        return `- "${i.title}" ${context}`
      }).join('\n')}\nTotal items: ${surfacedItems.length}\n`
    } else {
      prompt += `\nNo pressing action items. Acknowledge the quiet state: "Nothing pressing. What's on your mind?" or similar.\n`
    }

    if (staleItems.length > 0) {
      prompt += `\nStale items sitting for 2+ weeks with no due date:\n${staleItems.slice(0, 5).map(i => `- "${i.title}" (created ${new Date(i.created_at).toLocaleDateString()})`).join('\n')}\nBriefly mention these have been sitting - ask if Jason wants to clear them out. Don't be aggressive about it.\n`
    }

    if (recentlyCompleted.length > 0) {
      prompt += `\nRecently completed (last 24h):\n${recentlyCompleted.map(i => `- "${i.title}"`).join('\n')}\nBriefly acknowledge progress if relevant.\n`
    }

    if (emailScans.length > 0) {
      const totalProcessed = emailScans.reduce((sum: number, s: any) => sum + (s.emails_processed || 0), 0)
      const totalItems = emailScans.reduce((sum: number, s: any) => sum + (s.action_items_found || 0), 0)
      if (totalItems > 0 && sessionType === 'morning') {
        prompt += `\nEmail scanning pulled ${totalItems} action items from ${totalProcessed} emails recently.\n`
      }
    }

    if (recentMessages.length > 0) {
      const summary = recentMessages.map((m: any) => `${m.role}: ${m.content.slice(0, 100)}`).join('\n')
      prompt += `\nRecent conversation context (so you don't repeat):\n${summary}\n`
    }

    // Dashboard cards context - mention stale ones or if they're relevant to today's items
    if (dashboardCards.length > 0) {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      const staleCards = dashboardCards.filter((c: any) => new Date(c.updated_at) < sevenDaysAgo)
      if (staleCards.length > 0) {
        prompt += `\nDashboard cards that haven't been updated in 7+ days (briefly mention if relevant):\n${staleCards.map((c: any) => `- "${c.title}"`).join('\n')}\n`
      }
    }

    // Active projects - for context awareness
    if (recentProjects.length > 0) {
      prompt += `\nActive projects: ${recentProjects.map((p: any) => p.name).join(', ')}\n`
    }

    if (preferences.length > 0) {
      prompt += `\nUser preferences:\n${preferences.map(p => `- ${p}`).join('\n')}\n`
    }

    prompt += `\nRespond with ONLY the greeting text. No markdown headers. No "Good morning, Jason!" - just talk naturally.`

    // Call Claude Sonnet
    const response = await anthropic.messages.create({
      model: 'google/gemini-3.1-flash-lite-preview',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
      ...({ extra_body: { models: ['google/gemini-3.1-flash-lite-preview', 'google/gemini-3-flash-preview'], provider: { sort: 'price' } } } as any),
    })

    const greetingText = response.content
      .filter((block): block is Anthropic.Messages.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('')

    // Update last_surfaced_at on surfaced items
    if (surfacedItems.length > 0) {
      await supabaseAdmin
        .from('action_items')
        .update({ last_surfaced_at: new Date().toISOString() })
        .in('id', surfacedItems.map(i => i.id))
    }

    // Update last_greeting_at with cached greeting data
    const surfacedItemsPayload = surfacedItems.map(i => ({
      id: i.id,
      title: i.title,
      priority: i.priority,
      context: overdue.includes(i) ? 'overdue' : dueToday.includes(i) ? 'due_today' : 'active',
    }))

    await supabaseAdmin
      .from('user_state')
      .upsert({
        key: 'last_greeting_at',
        value: {
          timestamp: new Date().toISOString(),
          greeting_text: greetingText,
          surfaced_items: surfacedItemsPayload,
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' })

    return NextResponse.json({
      greeting_text: greetingText,
      surfaced_items: surfacedItemsPayload,
    })
  } catch (error) {
    console.error('Session greeting error:', error)
    return NextResponse.json({ skip: true, error: 'Failed to generate greeting' })
  }
}
