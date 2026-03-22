import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase'
import { spawnBackgroundJob } from '@/lib/background-jobs'
import { getMainConversation } from '@/lib/proactive'
import { parseJSON } from './memory-extraction'
import { BACKGROUND_LITE_MODELS, buildMetadata } from '@/lib/openrouter-models'
import { getLangfuse, flushLangfuse } from '@/lib/langfuse'

export async function getOrCreateSession(convId: string): Promise<{ sessionId: string | null; previousSummary: string | null }> {

  // Wrap entire session logic in a 5s timeout — if Supabase is slow/hung, chat still works.
  const sessionPromise = (async () => {
    // Look for open session
    console.log('[Session] query 1: looking for open session')
    const { data: openSession } = await supabaseAdmin
      .from('sessions')
      .select('*')
      .eq('conversation_id', convId)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    console.log('[Session] query 1 done, found:', !!openSession)

    const now = new Date()

    if (openSession) {
      // Check if we should close this session: 30+ messages OR last message > 2 hours ago
      console.log('[Session] query 2: getting last message')
      const { data: lastMsg } = await supabaseAdmin
        .from('messages')
        .select('created_at')
        .eq('session_id', openSession.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      console.log('[Session] query 2 done')

      const lastMsgAge = lastMsg
        ? (now.getTime() - new Date(lastMsg.created_at).getTime()) / (1000 * 60 * 60)
        : 0

      const shouldClose = openSession.message_count >= 30 || lastMsgAge > 2

      if (!shouldClose) {
        // Fetch previous closed session summary for injection
        console.log('[Session] query 3: getting prev session summary')
        const { data: prevSession } = await supabaseAdmin
          .from('sessions')
          .select('summary')
          .eq('conversation_id', convId)
          .not('ended_at', 'is', null)
          .order('ended_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        console.log('[Session] query 3 done, returning')

        return { sessionId: openSession.id, previousSummary: prevSession?.summary || null }
      }

      // Close the open session
      await supabaseAdmin
        .from('sessions')
        .update({ ended_at: now.toISOString() })
        .eq('id', openSession.id)

      // Note: session summarization intentionally skipped here - it was blocking the chat
      // request for 60+ seconds. TODO: move to nudge cron or a dedicated internal endpoint.
    }

    // Fetch last closed session summary
    const { data: lastClosed } = await supabaseAdmin
      .from('sessions')
      .select('summary')
      .eq('conversation_id', convId)
      .not('ended_at', 'is', null)
      .order('ended_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Create new session
    const { data: newSession } = await supabaseAdmin
      .from('sessions')
      .insert({ conversation_id: convId })
      .select()
      .maybeSingle()

    return { sessionId: newSession!.id, previousSummary: lastClosed?.summary || null }
  })()

  const timeout = new Promise<{ sessionId: string | null; previousSummary: string | null }>((resolve) =>
    setTimeout(() => {
      console.warn('[Session] timed out after 3s, skipping session tracking')
      resolve({ sessionId: null, previousSummary: null })
    }, 3000)
  )

  return Promise.race([sessionPromise, timeout])
}

export async function summarizeSession(sessionId: string, convId: string) {
  const lf = getLangfuse()
  const lfTrace = lf.trace({
    name: 'session_extraction',
    metadata: { session_id: sessionId, conversation_id: convId },
  })

  // Load all messages for this session
  const { data: messages } = await supabaseAdmin
    .from('messages')
    .select('role, content, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  if (!messages || messages.length === 0) { lfTrace.update({ output: 'no messages' }); await flushLangfuse(); return }

  const transcript = messages
    .map(m => `${m.role === 'user' ? 'Jason' : 'Crosby'}: ${m.content.slice(0, 500)}`)
    .join('\n\n')

  const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL })

  const response = await anthropicClient.messages.create({
    model: BACKGROUND_LITE_MODELS.primary,
    max_tokens: 800,
    system: `Summarize this conversation session for Jason DeMayo's AI workspace. Write bullet points under 400 words. Focus on: decisions made, information shared, action items created or discussed, open questions, and anything Crosby should remember for the next session. Be specific - include names, numbers, and dates.`,
    messages: [{ role: 'user', content: transcript }],
    ...({ extra_body: { models: [BACKGROUND_LITE_MODELS.primary, ...BACKGROUND_LITE_MODELS.fallbacks], provider: BACKGROUND_LITE_MODELS.provider, metadata: buildMetadata({ call_type: 'session_extraction' }) } } as any),
  })

  const summary = response.content[0].type === 'text' ? response.content[0].text : ''
  if (!summary) return

  // Save summary
  await supabaseAdmin
    .from('sessions')
    .update({ summary })
    .eq('id', sessionId)

  // Extract notepad entries from summary
  extractNotepadEntriesFromSummary(summary).catch(e => console.error('Notepad extraction failed:', e))

  // Extract commitments Jason made during this session
  extractCommitmentsFromSession(sessionId, convId, transcript).catch(e => console.error('Commitment extraction failed:', e))

  // Extract decisions Jason made during this session
  extractDecisionsFromSession(sessionId, convId, transcript).catch(e => console.error('Decision extraction failed:', e))

  // Phase 3: Detect SOPs - check if Jason explained a process step-by-step
  detectAndTrackProcesses(convId, transcript, summary).catch(e => console.error('SOP detection failed:', e))

  // Extract watches from conversation (things Jason is waiting for or tracking)
  extractWatchesFromSession(convId, transcript).catch(e => console.error('Watch extraction failed:', e))

  lfTrace.update({ output: `summarized ${messages.length} messages`, metadata: { session_id: sessionId, message_count: messages.length } })
  await flushLangfuse()
}

async function extractNotepadEntriesFromSummary(summary: string) {
  const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL })

  const notepadSchema = {
    type: 'object',
    properties: {
      entries: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            title: { type: 'string' },
          },
          required: ['content', 'title'],
          additionalProperties: false,
        },
      },
    },
    required: ['entries'],
    additionalProperties: false,
  }

  const response = await anthropicClient.messages.create({
    model: BACKGROUND_LITE_MODELS.primary,
    max_tokens: 400,
    system: `Extract 0-3 time-sensitive operational facts from this session summary that should go on the notepad. These are short-lived facts like "ordered deposit slips for 2262", "Roger is out this week", "waiting on callback from landlord at 1008". NOT general business knowledge. Return JSON: {"entries": [{"content": "...", "title": "..."}]} or {"entries": []} if nothing fits.`,
    messages: [{ role: 'user', content: summary }],
    ...({
      extra_body: {
        models: [BACKGROUND_LITE_MODELS.primary, ...BACKGROUND_LITE_MODELS.fallbacks],
        provider: { ...BACKGROUND_LITE_MODELS.provider, require_parameters: true },
        plugins: [{ id: 'response-healing' }],
        response_format: { type: 'json_schema', json_schema: { name: 'response', strict: true, schema: notepadSchema } },
        metadata: buildMetadata({ call_type: 'session_extraction' }),
      },
    } as any),
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = parseJSON(text)
  }
  if (!parsed.entries || parsed.entries.length === 0) return

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  for (const entry of parsed.entries) {
    if (entry.content) {
      await supabaseAdmin.from('notes').insert({
        content: entry.content,
        title: entry.title || null,
        expires_at: expiresAt,
      })
    }
  }
}

async function extractCommitmentsFromSession(sessionId: string, convId: string, transcript: string) {
  const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL })

  const commitmentSchema = {
    type: 'object',
    properties: {
      commitments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            commitment_text: { type: 'string' },
            target_date: { type: ['string', 'null'] },
            related_contact: { type: ['string', 'null'] },
          },
          required: ['commitment_text', 'target_date', 'related_contact'],
          additionalProperties: false,
        },
      },
    },
    required: ['commitments'],
    additionalProperties: false,
  }

  const response = await anthropicClient.messages.create({
    model: BACKGROUND_LITE_MODELS.primary,
    max_tokens: 400,
    system: `Extract commitments that JASON (the user) made during this conversation. Only extract things Jason said HE would do - not things Crosby (the AI) offered or did. Look for phrases like "I'll", "I need to", "I'm going to", "let me", "I should", "remind me to".

Examples of commitments: "I'll call Roger tomorrow", "I need to review the lease by Friday", "I'm going to email the franchise rep".

Do NOT extract:
- Things Crosby said it would do (drafting emails, creating items, etc.)
- Vague intentions without a clear action
- Things already captured as action items in the conversation

Today is ${new Date().toISOString().split('T')[0]}. Convert relative dates to absolute (e.g. "tomorrow" -> actual date, "next week" -> Monday of next week).

Return JSON: {"commitments": [{"commitment_text": "...", "target_date": "YYYY-MM-DD or null", "related_contact": "person name or null"}]}
Return {"commitments": []} if none found.`,
    messages: [{ role: 'user', content: transcript.slice(0, 6000) }],
    ...({
      extra_body: {
        models: [BACKGROUND_LITE_MODELS.primary, ...BACKGROUND_LITE_MODELS.fallbacks],
        provider: { ...BACKGROUND_LITE_MODELS.provider, require_parameters: true },
        plugins: [{ id: 'response-healing' }],
        response_format: { type: 'json_schema', json_schema: { name: 'response', strict: true, schema: commitmentSchema } },
        metadata: buildMetadata({ call_type: 'session_extraction' }),
      },
    } as any),
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = parseJSON(text)
  }
  if (!parsed.commitments || parsed.commitments.length === 0) return

  for (const c of parsed.commitments) {
    if (c.commitment_text) {
      await supabaseAdmin.from('commitments').insert({
        session_id: sessionId,
        conversation_id: convId,
        commitment_text: c.commitment_text,
        target_date: c.target_date || null,
        related_contact: c.related_contact || null,
      })
    }
  }
}

async function extractDecisionsFromSession(sessionId: string, convId: string, transcript: string) {
  const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL })
  const { generateEmbedding } = await import('@/lib/embeddings')

  const decisionSchema = {
    type: 'object',
    properties: {
      decisions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            decision_text: { type: 'string' },
            context: { type: ['string', 'null'] },
            alternatives_considered: { type: ['string', 'null'] },
          },
          required: ['decision_text', 'context', 'alternatives_considered'],
          additionalProperties: false,
        },
      },
    },
    required: ['decisions'],
    additionalProperties: false,
  }

  const response = await anthropicClient.messages.create({
    model: BACKGROUND_LITE_MODELS.primary,
    max_tokens: 600,
    system: `Extract decisions that JASON (the user) made during this conversation. Decisions are choices, directions, policies, or strategic calls - not tasks or commitments.

Examples of decisions:
- "Let's go with vendor X for the POS upgrade"
- "We're not renewing the lease at 1008"
- "I want to hold off on hiring until Q3"
- "We'll run the promo only on weekdays"

Do NOT extract:
- Tasks or action items (those are tracked separately)
- Commitments to do something (also tracked separately)
- Things Crosby suggested that Jason didn't explicitly agree to
- Vague preferences or off-hand comments

For each decision, include:
- decision_text: The decision itself, stated clearly
- context: Why Jason made this decision (if discussed)
- alternatives_considered: Other options that were discussed but not chosen (if any)

Return JSON: {"decisions": [{"decision_text": "...", "context": "...", "alternatives_considered": "..."}]}
Return {"decisions": []} if none found.`,
    messages: [{ role: 'user', content: transcript.slice(0, 6000) }],
    ...({
      extra_body: {
        models: [BACKGROUND_LITE_MODELS.primary, ...BACKGROUND_LITE_MODELS.fallbacks],
        provider: { ...BACKGROUND_LITE_MODELS.provider, require_parameters: true },
        plugins: [{ id: 'response-healing' }],
        response_format: { type: 'json_schema', json_schema: { name: 'response', strict: true, schema: decisionSchema } },
        metadata: buildMetadata({ call_type: 'session_extraction' }),
      },
    } as any),
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = parseJSON(text)
  }
  if (!parsed.decisions || parsed.decisions.length === 0) return

  for (const d of parsed.decisions) {
    if (!d.decision_text) continue

    // Insert decision
    const { data: inserted } = await supabaseAdmin.from('decisions').insert({
      session_id: sessionId,
      conversation_id: convId,
      decision_text: d.decision_text,
      context: d.context || null,
      alternatives_considered: d.alternatives_considered || null,
    }).select('id').single()

    // Generate and store embedding (fire-and-forget)
    if (inserted) {
      generateEmbedding(`${d.decision_text}${d.context ? ` — ${d.context}` : ''}`)
        .then(embedding => supabaseAdmin.from('decisions').update({ embedding }).eq('id', inserted.id))
        .catch(e => console.error('Decision embedding failed:', e))
    }
  }
}

async function extractWatchesFromSession(convId: string, transcript: string) {
  const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL })

  const watchSchema = {
    type: 'object',
    properties: {
      watches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            watch_type: { type: 'string', enum: ['email_reply', 'keyword', 'sender', 'topic'] },
            description: { type: 'string' },
            keywords: { type: 'array', items: { type: 'string' } },
            sender_email: { type: ['string', 'null'] },
            sender_domain: { type: ['string', 'null'] },
            priority: { type: 'string', enum: ['high', 'normal'] },
            semantic_context: { type: 'string' },
          },
          required: ['watch_type', 'description', 'keywords', 'sender_email', 'sender_domain', 'priority', 'semantic_context'],
          additionalProperties: false,
        },
      },
    },
    required: ['watches'],
    additionalProperties: false,
  }

  const response = await anthropicClient.messages.create({
    model: BACKGROUND_LITE_MODELS.primary,
    max_tokens: 600,
    system: `Review this conversation and identify things Jason is waiting for, tracking, or monitoring. Look for:
- Outreach he made ("I reached out to...", "I emailed...", "I sent that to...")
- Things he's waiting on ("waiting to hear back", "let's see if they respond", "should hear back soon")
- Pending items from others ("they said they'd send it", "she's supposed to get back to me")
- Decisions pending external input ("depends on what the city says", "once we get the numbers")
- Anything where a future event or response matters to Jason

For each, return:
- watch_type: "email_reply" if waiting for an email response, "sender" if monitoring a specific person, "keyword" if monitoring a topic, "topic" for general monitoring
- description: what Jason is waiting for, in plain language
- keywords: 3-8 relevant terms (org names, people, topics, locations)
- sender_email: specific email if known, null otherwise
- sender_domain: org domain if known (e.g. "sjearthquakes.com"), null otherwise
- priority: "high" if time-sensitive or important, "normal" otherwise
- semantic_context: rich context about what this is and why it matters, include project/topic it relates to

Return {"watches": []} if nothing found. Don't extract watches for vague or trivial items.`,
    messages: [{ role: 'user', content: transcript.slice(0, 6000) }],
    ...({
      extra_body: {
        models: [BACKGROUND_LITE_MODELS.primary, ...BACKGROUND_LITE_MODELS.fallbacks],
        provider: { ...BACKGROUND_LITE_MODELS.provider, require_parameters: true },
        plugins: [{ id: 'response-healing' }],
        response_format: { type: 'json_schema', json_schema: { name: 'response', strict: true, schema: watchSchema } },
        metadata: buildMetadata({ call_type: 'session_extraction' }),
      },
    } as any),
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = parseJSON(text)
  }
  if (!parsed.watches || parsed.watches.length === 0) return

  // Load existing active watches for deduplication
  const { data: existingWatches } = await supabaseAdmin
    .from('conversation_watches')
    .select('*')
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())

  // Load active notification rules to avoid overlap
  const { data: notifRules } = await supabaseAdmin
    .from('notification_rules')
    .select('match_type, match_value')
    .eq('is_active', true)

  const activeWatches = existingWatches || []
  const activeRules = notifRules || []

  let createdCount = 0

  for (const w of parsed.watches) {
    if (!w.description || !w.keywords || w.keywords.length === 0) continue

    const newKeywords = (w.keywords as string[]).map((k: string) => k.toLowerCase())

    // Dedup: check if notification_rules already cover this sender/keyword
    const coveredByRule = activeRules.some((rule: any) => {
      if (rule.match_type === 'sender' && w.sender_email && rule.match_value?.toLowerCase() === w.sender_email.toLowerCase()) return true
      if (rule.match_type === 'sender' && w.sender_domain && rule.match_value?.toLowerCase()?.includes(w.sender_domain.toLowerCase())) return true
      if (rule.match_type === 'keyword' && newKeywords.some((k: string) => rule.match_value?.toLowerCase()?.includes(k))) return true
      return false
    })
    if (coveredByRule) continue

    // Dedup: check existing watches for same sender_domain + 2+ overlapping keywords
    const isDuplicate = activeWatches.some((existing: any) => {
      const criteria = existing.match_criteria || {}
      const existingKeywords = (criteria.keywords || []).map((k: string) => k.toLowerCase())

      // Same sender_domain + 2+ keyword overlap
      if (w.sender_domain && criteria.sender_domain &&
          w.sender_domain.toLowerCase() === criteria.sender_domain.toLowerCase()) {
        const overlap = newKeywords.filter((k: string) => existingKeywords.includes(k)).length
        if (overlap >= 2) return true
      }

      // 50%+ keyword overlap (proxy for similar semantic_context)
      if (existingKeywords.length > 0 && newKeywords.length > 0) {
        const overlap = newKeywords.filter((k: string) => existingKeywords.includes(k)).length
        const overlapRatio = overlap / Math.min(newKeywords.length, existingKeywords.length)
        if (overlapRatio >= 0.5) return true
      }

      return false
    })
    if (isDuplicate) continue

    // Create the watch
    await supabaseAdmin.from('conversation_watches').insert({
      conversation_id: convId,
      watch_type: w.watch_type,
      match_criteria: {
        thread_id: null,
        sender_email: w.sender_email || null,
        sender_domain: w.sender_domain || null,
        keywords: w.keywords,
        semantic_context: w.semantic_context,
      },
      context: w.description,
      priority: w.priority || 'normal',
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    })
    createdCount++
  }

  // Store new watch descriptions on the session for greeting injection
  if (createdCount > 0) {
    const watchDescriptions = parsed.watches
      .slice(0, createdCount)
      .map((w: any) => w.description)
      .filter(Boolean)

    // Store in user_state so the session greeting can pick it up
    const { data: existing } = await supabaseAdmin
      .from('user_state')
      .select('value')
      .eq('key', 'recent_auto_watches')
      .single()

    const existingWatchList = existing?.value?.watches || []
    await supabaseAdmin
      .from('user_state')
      .upsert({
        key: 'recent_auto_watches',
        value: {
          watches: [...watchDescriptions, ...existingWatchList].slice(0, 10),
          updated_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' })

    console.log(`[watch-extraction] Created ${createdCount} watches from session in conversation ${convId}`)
  }
}

const SOP_DETECTION_SCHEMA = {
  type: 'object',
  properties: {
    process_detected: { type: 'boolean' },
    process_name: { type: 'string' },
    step_count: { type: 'number' },
  },
  required: ['process_detected', 'process_name', 'step_count'],
  additionalProperties: false,
}

async function detectAndTrackProcesses(convId: string, transcript: string, summary: string) {
  const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL })

  // Detect if a process was explained step-by-step
  const response = await anthropicClient.messages.create({
    model: BACKGROUND_LITE_MODELS.primary,
    max_tokens: 200,
    system: `Detect if Jason DeMayo explained a business process, procedure, or workflow step-by-step during this conversation. Examples: how they handle vendor invoices, how they open a new store, how they onboard GMs, how they handle a health inspection. NOT generic discussions - only when he clearly described steps/stages.

Return JSON: {"process_detected": true/false, "process_name": "Name of the process (e.g. 'New Store Opening Checklist')", "step_count": <estimated number of steps described>}
If no process detected: {"process_detected": false, "process_name": "", "step_count": 0}`,
    messages: [{ role: 'user', content: `Summary:\n${summary}\n\nKey transcript excerpts:\n${transcript.slice(0, 3000)}` }],
    ...({
      extra_body: {
        models: [BACKGROUND_LITE_MODELS.primary, ...BACKGROUND_LITE_MODELS.fallbacks],
        provider: { ...BACKGROUND_LITE_MODELS.provider, require_parameters: true },
        plugins: [{ id: 'response-healing' }],
        response_format: { type: 'json_schema', json_schema: { name: 'response', strict: true, schema: SOP_DETECTION_SCHEMA } },
        metadata: buildMetadata({ call_type: 'session_extraction' }),
      },
    } as any),
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    return
  }

  if (!parsed.process_detected || !parsed.process_name) return

  // Check if we already have this process in the DB
  const { data: existingProcesses } = await supabaseAdmin
    .from('detected_processes')
    .select('id, times_explained, conversation_ids, sop_drafted, step_count')
    .ilike('process_name', `%${parsed.process_name.slice(0, 30)}%`)
    .limit(1)

  if (existingProcesses && existingProcesses.length > 0) {
    const existing = existingProcesses[0]

    // Update: increment count and add conversation
    const updatedConvIds = [...(existing.conversation_ids || []), convId]
    const newCount = existing.times_explained + 1

    await supabaseAdmin
      .from('detected_processes')
      .update({
        times_explained: newCount,
        conversation_ids: updatedConvIds,
        last_explained_at: new Date().toISOString(),
        step_count: Math.max(existing.step_count || 0, parsed.step_count),
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)

    // If explained 2+ times and SOP not yet drafted, spawn a job
    if (newCount >= 2 && !existing.sop_drafted) {
      const mainConvId = await getMainConversation()
      const sopPrompt = `Draft a Standard Operating Procedure (SOP) document for the following business process: "${parsed.process_name}"

This process has been explained ${newCount} times in conversations. Pull together everything you know about it from conversation history, project context, and documents.

The SOP should include:
1. Purpose and scope
2. Step-by-step procedure (numbered)
3. Who is responsible for each step
4. Any tools, systems, or resources needed
5. Common pitfalls or notes

After creating the content, save it as a freeform artifact named "SOP: ${parsed.process_name}".

Then write a brief message to Jason saying something like: "I noticed you've explained the ${parsed.process_name} process a few times across different conversations. I drafted an SOP based on those discussions - take a look and let me know if it needs adjustments."`

      const job = await spawnBackgroundJob(mainConvId, 'sop', sopPrompt, 'sop_detection', {
        process_name: parsed.process_name,
        times_explained: newCount,
        detected_process_id: existing.id,
      })

      // Mark as SOP drafted
      await supabaseAdmin
        .from('detected_processes')
        .update({ sop_drafted: true, updated_at: new Date().toISOString() })
        .eq('id', existing.id)

      console.log(`SOP detection: spawned SOP draft job ${job.id} for "${parsed.process_name}"`)
    }
  } else {
    // First time seeing this process - insert it
    await supabaseAdmin.from('detected_processes').insert({
      process_name: parsed.process_name,
      conversation_ids: [convId],
      step_count: parsed.step_count,
      times_explained: 1,
      last_explained_at: new Date().toISOString(),
    })

    console.log(`SOP detection: first instance of process "${parsed.process_name}" recorded`)
  }
}
