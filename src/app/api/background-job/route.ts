/**
 * Background Job Executor
 *
 * Accepts a job_id, runs the job's prompt with full context (RAG, memories,
 * project context, action items), writes the result back to background_jobs,
 * posts a summary as a proactive message, and sends a push notification.
 *
 * Uses Claude Sonnet for complex research/analysis jobs,
 * Gemini Flash Lite for simpler builds and briefings.
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase'
import { openrouterClient } from '@/lib/openrouter'
import { getMainConversation } from '@/lib/proactive'
import { executeArtifactTool } from '@/lib/chat/tools/executors'
import { executeDeepResearch } from '@/lib/chat/web-search'
import { CHAT_MODELS, BACKGROUND_LITE_MODELS, buildMetadata } from '@/lib/openrouter-models'
import { getLangfuse, flushLangfuse } from '@/lib/langfuse'
import { sendPushToAll } from '@/lib/push'
import {
  retrieveRelevantChunks,
  getRelevantMemories,
  retrieveRelevantContextChunks,
  buildContext,
} from '@/lib/rag'
import { searchEmails } from '@/lib/gmail'
import { BASE_SYSTEM_PROMPT } from '@/lib/system-prompt'
import type { BackgroundJob } from '@/lib/background-jobs'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL,
})

export const maxDuration = 300 // 5 minutes for complex research

// Research/analysis jobs use Sonnet; deep_research uses Perplexity; simple builds use Flash Lite
const COMPLEX_JOB_TYPES = ['research', 'analysis', 'sop', 'deep_research']

export async function POST(req: NextRequest) {
  const auth = req.headers.get('x-cron-secret') || req.headers.get('authorization')
  const isAuthorized =
    auth === process.env.CRON_SECRET ||
    auth === `Bearer ${process.env.CRON_SECRET}` ||
    auth === 'manual'

  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let jobId: string
  try {
    const body = await req.json()
    jobId = body.job_id
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!jobId) {
    return NextResponse.json({ error: 'job_id is required' }, { status: 400 })
  }

  // Load the job
  const { data: job, error: loadError } = await supabaseAdmin
    .from('background_jobs')
    .select('*')
    .eq('id', jobId)
    .single()

  if (loadError || !job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  // Guard: don't re-run completed or already-running jobs
  if (job.status === 'completed' || job.status === 'running') {
    return NextResponse.json({ message: `Job already ${job.status}`, job_id: jobId })
  }

  // Mark as running
  await supabaseAdmin
    .from('background_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', jobId)

  const lf = getLangfuse()
  const lfTrace = lf.trace({
    name: 'background_job',
    input: (job as any).prompt?.slice(0, 500),
    metadata: { job_id: jobId, job_type: (job as any).job_type, conversation_id: (job as any).conversation_id },
  })

  try {
    const result = await executeJob(job as BackgroundJob)

    // Mark completed and store result
    await supabaseAdmin
      .from('background_jobs')
      .update({
        status: 'completed',
        result,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    const convId = job.conversation_id || await getMainConversation()
    const topicSummary = (job.metadata as any)?.topic_summary as string | undefined

    // Create an artifact with the result so it opens in the side panel
    const artifactName = topicSummary || 'Research Report'
    const artifactResult = await executeArtifactTool(
      { operation: 'create', name: artifactName, content: result, type: 'freeform' },
      convId,
      null,
    )
    const artifactId = artifactResult.artifact?.id

    // Insert a short proactive message that points to the artifact
    const announcement = topicSummary
      ? `Research on "${topicSummary}" just came back — full report is in the panel.`
      : `That research just came back — full report is in the panel.`

    await supabaseAdmin.from('messages').insert({
      conversation_id: convId,
      role: 'assistant',
      content: announcement,
      ...(artifactId ? { metadata: { open_artifact_id: artifactId } } : {}),
    })

    // Touch conversation so it surfaces in recency sorting
    await supabaseAdmin
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', convId)

    // Push notification
    const pushBody = topicSummary
      ? `Research on "${topicSummary}" is ready.`
      : `Your background research just finished — check your chat.`
    await sendPushToAll('Research ready', pushBody, `/chat/${convId}`)

    lfTrace.update({ output: result.slice(0, 500) })
    await flushLangfuse()

    return NextResponse.json({ status: 'completed', job_id: jobId, result_length: result.length })
  } catch (err: any) {
    console.error('Background job failed:', err)

    await supabaseAdmin
      .from('background_jobs')
      .update({
        status: 'failed',
        error: err.message || 'Unknown error',
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    return NextResponse.json({ status: 'failed', job_id: jobId, error: err.message }, { status: 500 })
  }
}

async function executeJob(job: BackgroundJob): Promise<string> {
  // Deep research: call Perplexity directly, skip the normal AI pipeline
  if (job.job_type === 'deep_research') {
    const { result } = await executeDeepResearch(job.prompt)
    if (!result) throw new Error('Perplexity returned empty response')
    return result
  }

  const isComplex = COMPLEX_JOB_TYPES.includes(job.job_type)
  const model = isComplex
    ? CHAT_MODELS.primary
    : BACKGROUND_LITE_MODELS.primary

  // Complex jobs use Claude via Anthropic SDK; simple jobs use Gemini via openrouterClient
  const extraBody = {
    extra_body: {
      models: [CHAT_MODELS.primary, ...CHAT_MODELS.fallbacks],
      provider: CHAT_MODELS.provider,
      metadata: buildMetadata({ call_type: 'background_job' }),
    },
  }

  // Load context relevant to this job's prompt
  const contextParts: string[] = []

  try {
    const [chunks, memories, contextChunks] = await Promise.all([
      retrieveRelevantChunks(job.prompt, undefined, 8, 0.65),
      getRelevantMemories(job.prompt, 8),
      retrieveRelevantContextChunks(job.prompt, undefined, 6, 0.65),
    ])

    const ragContext = buildContext(chunks, [], memories, contextChunks)
    if (ragContext) contextParts.push(`## Retrieved Context\n${ragContext}`)
  } catch (e: any) {
    console.error('Context loading failed for background job:', e.message)
  }

  // Load active action items for context
  try {
    const { data: actionItems } = await supabaseAdmin
      .from('action_items')
      .select('title, description, priority, due_date, status')
      .in('status', ['pending', 'approved'])
      .order('priority', { ascending: true })
      .limit(20)

    if (actionItems && actionItems.length > 0) {
      const itemLines = actionItems.map(
        (i: any) => `- [${i.priority}] ${i.title}${i.due_date ? ` (due ${i.due_date})` : ''}`
      ).join('\n')
      contextParts.push(`## Current Action Items\n${itemLines}`)
    }
  } catch (e: any) {
    console.error('Action item load failed:', e.message)
  }

  // If the job prompt mentions emails, pull relevant ones
  if (
    job.prompt.toLowerCase().includes('email') ||
    job.prompt.toLowerCase().includes('gmail') ||
    job.job_type === 'research'
  ) {
    try {
      const emailQuery = extractEmailSearchQuery(job.prompt)
      if (emailQuery) {
        const emails = await searchEmails(emailQuery, 5)
        if (emails.length > 0) {
          const emailSection = emails.map(
            (e: any) => `From: ${e.from}\nSubject: ${e.subject}\n${e.body?.slice(0, 600) || ''}`
          ).join('\n\n---\n\n')
          contextParts.push(`## Relevant Emails\n${emailSection}`)
        }
      }
    } catch (e: any) {
      console.error('Email search failed for background job:', e.message)
    }
  }

  const contextBlock = contextParts.join('\n\n')

  const systemPrompt = `${BASE_SYSTEM_PROMPT}

You are running as a background agent - no user is present. Your job is to do thorough research and analysis, then write a clear, useful result that will be posted as a message in Jason's chat. Be specific, include relevant numbers/dates/names, and be actionable. Format with markdown headers and bullets where helpful. Keep it focused - no padding.

${contextBlock ? `\n\n${contextBlock}` : ''}`

  let text: string
  if (isComplex) {
    // Complex jobs: use Claude Sonnet via Anthropic SDK
    const response = await anthropic.messages.create({
      model,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: job.prompt }],
      ...(extraBody as any),
    })
    text = response.content[0].type === 'text' ? response.content[0].text : ''
  } else {
    // Simple jobs: use Gemini via openrouterClient to avoid Anthropic SDK header routing issues
    const response = await openrouterClient.chat.completions.create({
      model,
      max_tokens: 2000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: job.prompt },
      ],
      ...({
        models: [BACKGROUND_LITE_MODELS.primary, ...BACKGROUND_LITE_MODELS.fallbacks],
        provider: BACKGROUND_LITE_MODELS.provider,
        metadata: buildMetadata({ call_type: 'background_job' }),
      } as any),
    } as any)
    text = response.choices[0]?.message?.content || ''
  }
  if (!text) throw new Error('AI returned empty response')

  return text
}

/**
 * Extract a useful Gmail search query from the job prompt.
 */
function extractEmailSearchQuery(prompt: string): string | null {
  // Look for quoted terms, store names, or key nouns
  const quotedMatch = prompt.match(/"([^"]+)"/)
  if (quotedMatch) return quotedMatch[1]

  // Look for store names or common keywords
  const storeMatch = prompt.match(/store\s+(\d+)|#(\d+)/i)
  if (storeMatch) return storeMatch[1] || storeMatch[2]

  // Extract key noun phrases (first 5 words after "about" or "regarding")
  const aboutMatch = prompt.match(/(?:about|regarding|related to|re:)\s+(.{10,50}?)(?:\.|,|$)/i)
  if (aboutMatch) return aboutMatch[1].trim()

  return null
}
