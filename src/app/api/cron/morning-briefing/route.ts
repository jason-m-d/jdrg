import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase'
import { buildBriefingPrompt } from '@/lib/system-prompt'
import { getMainConversation, insertProactiveMessage, getUserPreferences } from '@/lib/proactive'
import { sendPushToAll } from '@/lib/push'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret') || req.headers.get('authorization')
  if (cronSecret !== process.env.CRON_SECRET && cronSecret !== 'manual' && cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Load preferences
    const preferences = await getUserPreferences()

    // Gather yesterday's sales
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().split('T')[0]

    const { data: salesData } = await supabaseAdmin
      .from('sales_data')
      .select('store_number, store_name, brand, net_sales')
      .eq('report_date', yesterdayStr)

    // Gather pending action items
    const { data: actionItems } = await supabaseAdmin
      .from('action_items')
      .select('title, status, priority, due_date')
      .in('status', ['pending', 'approved'])
      .order('priority')
      .order('created_at', { ascending: false })

    // Gather email scan stats + dashboard cards + notification rules
    const { data: emailScans } = await supabaseAdmin
      .from('email_scans')
      .select('account, emails_processed, action_items_found, last_scanned_at')

    const { data: dashboardCards } = await supabaseAdmin
      .from('dashboard_cards')
      .select('title, content, card_type')
      .eq('is_active', true)
      .order('position')

    const { data: notificationRules } = await supabaseAdmin
      .from('notification_rules')
      .select('description, match_type, match_value, is_active')
      .eq('is_active', true)

    // Build prompt
    const systemPrompt = buildBriefingPrompt({
      salesData: (salesData || []).map((s: any) => ({
        store_number: s.store_number,
        store_name: s.store_name || s.store_number,
        brand: s.brand,
        net_sales: s.net_sales || 0,
      })),
      actionItems: (actionItems || []).map((i: any) => ({
        title: i.title,
        status: i.status,
        priority: i.priority,
        due_date: i.due_date,
      })),
      emailScanStats: (emailScans || []).map((s: any) => ({
        account: s.account,
        emails_processed: s.emails_processed || 0,
        action_items_found: s.action_items_found || 0,
        last_scanned_at: s.last_scanned_at,
      })),
    }, preferences)

    // Append dashboard cards and notification rules context
    let fullPrompt = systemPrompt

    if (dashboardCards && dashboardCards.length > 0) {
      const cardLines = dashboardCards.map((c: any) => `- "${c.title}" (${c.card_type}): ${c.content.slice(0, 100)}`)
      fullPrompt += `\n\nActive Dashboard Cards (mention if any are stale or worth updating):\n${cardLines.join('\n')}`
    }

    if (notificationRules && notificationRules.length > 0) {
      const ruleLines = notificationRules.map((r: any) => `- ${r.description} (${r.match_type}: "${r.match_value}")`)
      fullPrompt += `\n\nActive Notification Rules (mention only if relevant to today's items):\n${ruleLines.join('\n')}`
    }

    // Generate briefing via Claude
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: fullPrompt,
      messages: [{ role: 'user', content: 'Generate the morning briefing.' }],
    })

    const briefingText = response.content[0].type === 'text' ? response.content[0].text : ''

    // Format with prefix
    const today = new Date()
    const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    const fullMessage = `☀️ **Morning Briefing - ${dateStr}**\n\n${briefingText}`

    // Insert into main conversation
    const convId = await getMainConversation()
    await insertProactiveMessage(convId, fullMessage)

    // Push notification
    await sendPushToAll('Morning Briefing', `Your ${dateStr} briefing is ready.`, `/chat/${convId}`)

    return NextResponse.json({ status: 'ok', conversation_id: convId })
  } catch (error) {
    console.error('Morning briefing failed:', error)
    return NextResponse.json({ error: 'Failed to generate briefing' }, { status: 500 })
  }
}

// Vercel Cron uses GET
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return POST(req)
}
