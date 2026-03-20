/**
 * Overnight Build Cron
 *
 * Runs at 2am. Reviews the last 48 hours of conversations for:
 * - Wishes ("I wish I had...", "it would be nice if...", "I need a way to...")
 * - Repeated questions or manual work (same type of question 3+ times)
 * - Pain points and frustrations
 *
 * If it finds something actionable, spawns a background job to build it:
 * - Artifact (checklist, template, SOP, reference doc)
 * - Dashboard card with computed data
 * - Project context entry synthesizing scattered knowledge
 *
 * Conservative: max 1-2 builds per week. Tracks what it's built in user_state
 * to avoid rebuilding things.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getMainConversation } from '@/lib/proactive'
import { spawnBackgroundJob, getDailyAutoTriggerCount, logAutoTrigger } from '@/lib/background-jobs'
import { openrouterClient } from '@/lib/openrouter'
import { logCronJob } from '@/lib/activity-log'

export const maxDuration = 60

const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    opportunities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['template', 'checklist', 'reference_doc', 'dashboard_card', 'sop'] },
          title: { type: 'string' },
          reason: { type: 'string' },
          build_prompt: { type: 'string' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['type', 'title', 'reason', 'build_prompt', 'priority'],
        additionalProperties: false,
      },
    },
  },
  required: ['opportunities'],
  additionalProperties: false,
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('x-cron-secret') || req.headers.get('authorization')
  const isAuthorized =
    auth === process.env.CRON_SECRET ||
    auth === `Bearer ${process.env.CRON_SECRET}` ||
    auth === 'manual'

  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronStart = Date.now()

  // Weekly gate: max 2 overnight builds per week
  const { data: gateState } = await supabaseAdmin
    .from('user_state')
    .select('value')
    .eq('key', 'overnight_build_state')
    .single()

  const buildState = gateState?.value || { builds_this_week: 0, week_start: null, built_titles: [] }

  // Reset weekly counter if it's a new week
  const now = new Date()
  const weekStart = buildState.week_start ? new Date(buildState.week_start) : null
  const isNewWeek = !weekStart || (now.getTime() - weekStart.getTime() > 7 * 24 * 3600000)

  if (isNewWeek) {
    buildState.builds_this_week = 0
    buildState.week_start = now.toISOString()
  }

  if (buildState.builds_this_week >= 2) {
    void logCronJob({ job_name: 'overnight-build', success: true, duration_ms: Date.now() - cronStart, summary: 'Weekly build cap reached (2 builds/week)' })
    return NextResponse.json({ message: 'Weekly build cap reached (2 builds/week)', skipped: true })
  }

  // Global daily auto-trigger cap
  const dailyCount = await getDailyAutoTriggerCount()
  if (dailyCount >= 5) {
    void logCronJob({ job_name: 'overnight-build', success: true, duration_ms: Date.now() - cronStart, summary: 'Daily auto-trigger cap reached' })
    return NextResponse.json({ message: 'Daily auto-trigger cap reached', skipped: true })
  }

  // Load last 48 hours of user messages
  const since48h = new Date(now.getTime() - 48 * 3600000).toISOString()
  const { data: recentMessages } = await supabaseAdmin
    .from('messages')
    .select('role, content, created_at')
    .eq('role', 'user')
    .gte('created_at', since48h)
    .order('created_at', { ascending: true })
    .limit(100)

  if (!recentMessages || recentMessages.length < 5) {
    void logCronJob({ job_name: 'overnight-build', success: true, duration_ms: Date.now() - cronStart, summary: 'Not enough recent conversation data' })
    return NextResponse.json({ message: 'Not enough recent conversation data', skipped: true })
  }

  // Build conversation transcript
  const transcript = recentMessages
    .map((m: any) => `[${new Date(m.created_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}] User: ${m.content.slice(0, 400)}`)
    .join('\n')

  const alreadyBuilt: string[] = buildState.built_titles || []

  // Analyze for opportunities
  const response = await openrouterClient.chat.completions.create({
    model: 'google/gemini-3.1-flash-lite-preview',
    max_tokens: 1200,
    messages: [
      { role: 'system', content: `You are analyzing conversation transcripts to find opportunities to proactively build something useful for Jason DeMayo (CEO of DeMayo Restaurant Group - 8 Wingstop, 2 Mr. Pickle's).

Look for:
1. Explicit wishes: "I wish I had", "it would be nice if", "I need a way to", "someone should make"
2. Repeated questions: same type of question asked 3+ times in 48h (e.g. asking about labor costs at a specific store multiple times)
3. Pain points: frustration with a manual process, having to look something up repeatedly
4. Patterns suggesting a template or checklist would help (e.g. recurring weekly review steps, onboarding steps mentioned)

What you can build:
- "template": a reusable document template (e.g. "Weekly Store Review Template")
- "checklist": a checklist for a repeated process (e.g. "Opening Checklist for Store 451")
- "reference_doc": a compiled reference document (e.g. "Vendor Contacts Reference")
- "dashboard_card": a summary card with computed info
- "sop": a standard operating procedure document

Rules:
- Only suggest if there's a CLEAR opportunity based on the conversation (not hypothetical)
- Do NOT rebuild things already built: ${alreadyBuilt.length > 0 ? alreadyBuilt.join(', ') : '(nothing built yet)'}
- Max 1-2 opportunities
- The build_prompt should be a specific, detailed instruction for an AI agent to create the artifact

Return JSON: {"opportunities": [{"type": "template", "title": "...", "reason": "Jason asked about X three times today", "build_prompt": "Create a detailed...", "priority": "high"}]}
Return {"opportunities": []} if nothing actionable found.` },
      { role: 'user', content: `Recent conversations (last 48h):\n\n${transcript}` },
    ],
    ...({
      models: ['google/gemini-3.1-flash-lite-preview', 'google/gemini-3-flash-preview'],
      provider: { sort: 'price' },
      plugins: [{ id: 'response-healing' }],
      response_format: { type: 'json_schema', json_schema: { name: 'response', strict: true, schema: ANALYSIS_SCHEMA } },
    } as any),
  } as any)

  const text = response.choices[0]?.message?.content || ''
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    void logCronJob({ job_name: 'overnight-build', success: false, duration_ms: Date.now() - cronStart, summary: 'Failed to parse AI analysis' })
    return NextResponse.json({ message: 'Failed to parse AI analysis', skipped: true })
  }

  if (!parsed.opportunities || parsed.opportunities.length === 0) {
    void logCronJob({ job_name: 'overnight-build', success: true, duration_ms: Date.now() - cronStart, summary: 'No actionable opportunities found' })
    return NextResponse.json({ message: 'No actionable opportunities found', skipped: true })
  }

  const convId = await getMainConversation()
  const spawned: string[] = []

  // Spawn background jobs for top opportunities (high priority first)
  const sorted = parsed.opportunities.sort((a: any, b: any) => {
    const order: Record<string, number> = { high: 0, medium: 1, low: 2 }
    return (order[a.priority] ?? 1) - (order[b.priority] ?? 1)
  })

  for (const opp of sorted.slice(0, 2 - buildState.builds_this_week)) {
    // Don't rebuild
    if (alreadyBuilt.some((t: string) => t.toLowerCase() === opp.title.toLowerCase())) continue

    const fullPrompt = `${opp.build_prompt}

After creating the content, use the manage_artifact tool to save it as an artifact (type: "${opp.type === 'sop' || opp.type === 'reference_doc' ? 'freeform' : opp.type === 'template' ? 'freeform' : opp.type}"). Name it: "${opp.title}".

Then write a brief message to Jason explaining what you built and why: "${opp.reason}". Keep it to 2-3 sentences.`

    try {
      const job = await spawnBackgroundJob(
        convId,
        'overnight_build',
        fullPrompt,
        'overnight_build',
        { title: opp.title, type: opp.type, reason: opp.reason }
      )

      await logAutoTrigger('overnight_build', opp.title, job.id, {
        type: opp.type,
        reason: opp.reason,
        priority: opp.priority,
      })

      spawned.push(opp.title)
      buildState.builds_this_week++
      alreadyBuilt.push(opp.title)

      console.log(`Overnight build: spawned job ${job.id} for "${opp.title}"`)
    } catch (e: any) {
      console.error(`Overnight build failed for "${opp.title}":`, e.message)
    }
  }

  // Update gate state
  buildState.built_titles = alreadyBuilt
  await supabaseAdmin.from('user_state').upsert({
    key: 'overnight_build_state',
    value: buildState,
    updated_at: now.toISOString(),
  }, { onConflict: 'key' })

  void logCronJob({ job_name: 'overnight-build', success: true, duration_ms: Date.now() - cronStart, summary: spawned.length > 0 ? `Spawned ${spawned.length} overnight build(s)` : 'No builds needed' })
  return NextResponse.json({
    message: spawned.length > 0 ? `Spawned ${spawned.length} overnight build(s)` : 'No builds needed',
    builds_spawned: spawned,
    builds_this_week: buildState.builds_this_week,
  })
}

// Support GET for Vercel Cron
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return POST(req)
}
