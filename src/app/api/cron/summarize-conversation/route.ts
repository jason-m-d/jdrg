import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'
import { logCronJob } from '@/lib/activity-log'
import { BACKGROUND_LITE_MODELS, buildMetadata } from '@/lib/openrouter-models'
import { reportCronFailure } from '@/lib/cron-alerting'

export const maxDuration = 60

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL })

// ~80K token threshold (chars / 4 heuristic). Leaves ample room for system prompt + structured data.
const TOKEN_THRESHOLD = 80_000
const CHARS_PER_TOKEN = 4

// Keep the most recent 20 messages out of summarization so context stays fresh
const KEEP_RECENT = 20

// Support GET for Vercel Cron
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return POST(req)
}

export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret') || req.headers.get('authorization')
  if (cronSecret !== process.env.CRON_SECRET && cronSecret !== 'manual' && cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronStart = Date.now()

  try {

  // Load the main conversation(s) - non-project conversations
  const { data: conversations } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .is('project_id', null)
    .order('updated_at', { ascending: false })
    .limit(5)

  if (!conversations || conversations.length === 0) {
    void logCronJob({ job_name: 'summarize-conversation', success: true, duration_ms: Date.now() - cronStart, summary: 'No conversations found' })
    return NextResponse.json({ message: 'No conversations found', summarized: 0 })
  }

  let summarized = 0

  for (const conv of conversations) {
    try {
      const did = await maybeRunSummarization(conv.id)
      if (did) summarized++
    } catch (err) {
      console.error(`[summarize-conversation] failed for conv ${conv.id}:`, err)
    }
  }

  void logCronJob({ job_name: 'summarize-conversation', success: true, duration_ms: Date.now() - cronStart, summary: `Ran summarization on ${summarized} conversation(s)` })
  return NextResponse.json({ message: `Ran summarization on ${summarized} conversation(s)`, summarized })
  } catch (fatalErr: any) {
    console.error('[summarize-conversation] FATAL:', fatalErr?.message)
    void logCronJob({ job_name: 'summarize-conversation', success: false, duration_ms: Date.now() - cronStart, summary: `Fatal error: ${fatalErr?.message?.slice(0, 200)}` })
    void reportCronFailure('summarize-conversation', fatalErr)
    return NextResponse.json({ error: fatalErr?.message || 'Unknown error' }, { status: 500 })
  }
}

async function maybeRunSummarization(convId: string): Promise<boolean> {
  // Load latest summary to get pointer
  const { data: latestSummary } = await supabaseAdmin
    .from('conversation_summaries')
    .select('id, summary_text, summarized_through_at, created_at')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Load all messages after the pointer (or all if no summary)
  const msgQuery = supabaseAdmin
    .from('messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: true })

  if (latestSummary) {
    msgQuery.gt('created_at', latestSummary.summarized_through_at)
  }

  const { data: messages } = await msgQuery

  if (!messages || messages.length <= KEEP_RECENT) {
    return false // not enough new messages to bother
  }

  // Calculate total char count of unsummarized messages
  const totalChars = messages.reduce((sum, m) => sum + (m.content || '').length, 0)
  const estimatedTokens = Math.ceil(totalChars / CHARS_PER_TOKEN)

  // Force-summarize check: if it's been 24h since last summarization
  const lastSummarizedAt = latestSummary?.created_at ? new Date(latestSummary.created_at) : null
  const hoursSinceSummarization = lastSummarizedAt
    ? (Date.now() - lastSummarizedAt.getTime()) / (1000 * 60 * 60)
    : Infinity

  const shouldSummarize = estimatedTokens >= TOKEN_THRESHOLD || hoursSinceSummarization >= 24

  if (!shouldSummarize) {
    console.log(`[summarize-conversation] conv ${convId}: ${estimatedTokens} tokens, ${hoursSinceSummarization.toFixed(1)}h since last — skipping`)
    return false
  }

  // Summarize everything EXCEPT the most recent KEEP_RECENT messages
  const messagesToSummarize = messages.slice(0, messages.length - KEEP_RECENT)
  const lastSummarizedMsg = messagesToSummarize[messagesToSummarize.length - 1]

  const transcript = messagesToSummarize
    .map(m => `[${m.role === 'user' ? 'Jason' : 'Crosby'}]: ${(m.content || '').slice(0, 800)}`)
    .join('\n\n')

  const previousSummary = latestSummary?.summary_text || null

  const summaryText = await generateSummary(transcript, previousSummary)
  if (!summaryText) return false

  await supabaseAdmin.from('conversation_summaries').insert({
    conversation_id: convId,
    summary_text: summaryText,
    summarized_through_message_id: lastSummarizedMsg.id,
    summarized_through_at: lastSummarizedMsg.created_at,
    token_count_at_summarization: estimatedTokens,
  })

  console.log(`[summarize-conversation] conv ${convId}: summarized ${messagesToSummarize.length} messages (~${estimatedTokens} tokens)`)
  return true
}

async function generateSummary(transcript: string, previousSummary: string | null): Promise<string> {
  const response = await client.messages.create({
    model: BACKGROUND_LITE_MODELS.primary,
    max_tokens: 2000,
    system: `You are summarizing a conversation between Jason (CEO of DeMayo Restaurant Group and Hungry Hospitality Group) and his AI assistant Crosby.

${previousSummary ? `Previous summary of older conversation:\n${previousSummary}\n\n` : ''}Summarize the following messages into a concise context brief. Focus on:
- Decisions made and their reasoning
- Action items discussed (who needs to do what)
- Topics covered and current status
- Any unresolved questions or open threads
- Key facts or numbers mentioned

Keep it under 2000 words. Write it as a narrative brief, not bullet points. This summary will be injected into future conversations so Crosby has context about what happened before.`,
    messages: [{ role: 'user', content: `Messages to summarize:\n\n${transcript}` }],
    ...({
      extra_body: {
        models: [BACKGROUND_LITE_MODELS.primary, ...BACKGROUND_LITE_MODELS.fallbacks],
        provider: BACKGROUND_LITE_MODELS.provider,
        metadata: buildMetadata({ call_type: 'cron_summarize' }),
      },
    } as any),
  })

  return response.content[0].type === 'text' ? response.content[0].text : ''
}
