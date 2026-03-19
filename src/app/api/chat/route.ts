import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase'
import { classifyIntent, getToolsForDomains } from '@/lib/intent-classifier'
import { routeMessage } from '@/lib/router'
import { prefetchCache } from '@/app/api/chat/prefetch/route'
import { searchEmails, createDraft } from '@/lib/gmail'
import { spawnBackgroundJob } from '@/lib/background-jobs'
import { ALL_TOOLS_MAP, REQUEST_ADDITIONAL_CONTEXT_TOOL } from '@/lib/chat/tools/definitions'
import { toolStatusLabels } from '@/lib/chat/tools/status-labels'
import {
  executeSearchTexts,
  executeManageTextContacts,
  executeManageGroupWhitelist,
  executeCheckCalendar,
  executeFindAvailability,
  executeCreateCalendarEvent,
  executeQuerySales,
  executeActionItemTool,
  executeArtifactTool,
  executeManageProjectContext,
  executeProjectTool,
  executeBookmarkTool,
  executeDashboardCardTool,
  executeNotificationRuleTool,
  executePreferencesTool,
  executeTrainingTool,
  executeNotepadTool,
  executeContactsTool,
  executeCreateWatch,
  executeListWatches,
  executeCancelWatch,
  executeWebSearch,
} from '@/lib/chat/tools/executors'
import { getOrCreateSession } from '@/lib/chat/session'
import { extractMemories } from '@/lib/chat/memory-extraction'
import { resolveSpecialists, specialistRegistry } from '@/lib/specialists/registry'
import { loadDataBlocks } from '@/lib/chat/context-loader'
import { buildSpecialistPrompt } from '@/lib/specialists/prompt-builder'
import type { SpecialistDefinition } from '@/lib/specialists/types'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL })

export async function POST(req: NextRequest) {
  const { message, conversation_id, project_id, active_artifact_id, model } = await req.json()
  const selectedModel = model || 'anthropic/claude-sonnet-4.6:exacto'

  const encoder = new TextEncoder()
  let fullResponse = ''
  let isErrorResponse = false

  const stream = new ReadableStream({
    async start(controller) {
      // Emit ping immediately so the HTTP connection is established
      controller.enqueue(encoder.encode('data: {"type":"ping"}\n\n'))

      try {
        // Create or get conversation
        let convId = conversation_id
        if (!convId) {
          const title = message.slice(0, 50) + (message.length > 50 ? '...' : '')
          const { data: conv } = await supabaseAdmin
            .from('conversations')
            .insert({ title, project_id })
            .select()
            .single()
          convId = conv.id
        }

        // Get or create session
        const { sessionId, previousSummary } = await getOrCreateSession(convId)

        // Save user message
        await supabaseAdmin.from('messages').insert({
          conversation_id: convId,
          role: 'user',
          content: message,
          ...(sessionId ? { session_id: sessionId } : {}),
        })

        // Load conversation history — scoped to session if we have one
        console.log('[Chat] step 4: load history')
        const historyQuery = supabaseAdmin
          .from('messages')
          .select('role, content, context_domains')
          .eq('conversation_id', convId)
          .order('created_at', { ascending: true })
          .limit(20)
        const { data: history } = await (sessionId ? historyQuery.eq('session_id', sessionId) : historyQuery)

        // Always load all projects first — router needs them for project matching, cheap query
        const allProjectsResult = await supabaseAdmin.from('projects').select('id, name, description').order('name')
        const allProjects: { id: string; name: string; description: string | null }[] = allProjectsResult.data || []

        // Route the message via AI router (with classifyIntent fallback built in).
        // Check the prefetch cache first.
        console.log('[Chat] step 5: routing message')
        const recentMessages = ((history || []).slice(-3)).map((m: any) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content || '',
        }))
        let routerResult: Awaited<ReturnType<typeof routeMessage>>
        const PREFETCH_TTL_MS = 10_000
        const prefetchHit = prefetchCache.get(message) ||
          (() => {
            for (const [key, entry] of prefetchCache) {
              if (message.startsWith(key) && Date.now() - entry.timestamp < PREFETCH_TTL_MS) return entry
            }
            return null
          })()

        if (prefetchHit && Date.now() - prefetchHit.timestamp < PREFETCH_TTL_MS) {
          console.log(`[Chat] prefetch cache hit — skipping router call`)
          routerResult = prefetchHit.routerResult
        } else {
          try {
            routerResult = await routeMessage(message, recentMessages, allProjects)
          } catch (routerErr: any) {
            console.error('[Chat] routeMessage threw unexpectedly, falling back:', routerErr?.message)
            const lastAssistantMsg = (history || []).slice().reverse().find((m: any) => m.role === 'assistant')
            const recentDomains = lastAssistantMsg?.context_domains as string[] | null
            const fallbackDomains = classifyIntent(message, recentDomains)
            routerResult = {
              intent: message.slice(0, 100),
              data_needed: Array.from(fallbackDomains),
              tools_needed: getToolsForDomains(fallbackDomains),
              rag_query: message,
              complexity: 'medium',
              relevant_projects: [],
              fromFallback: true,
            }
          }
        }

        console.log(`[Router] result: intent="${routerResult.intent.slice(0, 60)}" | data=[${routerResult.data_needed.join(', ')}] | tools=${routerResult.tools_needed.length}${routerResult.fromFallback ? ' (fallback)' : ''}`)

        // Resolve specialists for this message
        const activeSpecialists = resolveSpecialists(routerResult)
        console.log('[Chat] active specialists:', activeSpecialists.map(s => s.id).join(', '))

        // Resolve relevant project IDs from names the router returned
        const relevantProjectIds: string[] = routerResult.relevant_projects.length > 0
          ? allProjects
              .filter(p => routerResult.relevant_projects.some(
                name => p.name.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(p.name.toLowerCase())
              ))
              .map(p => p.id)
          : []

        // Build the data needed set from active specialists (union of all their dataNeeded)
        // Plus anything the router explicitly requested (handles edge cases and fallback path)
        const specialistDataNeeded = new Set<string>()
        for (const s of activeSpecialists) {
          for (const block of s.dataNeeded) specialistDataNeeded.add(block)
        }
        for (const block of routerResult.data_needed) specialistDataNeeded.add(block)

        // Load project system prompt in parallel with data (needed for prompt builder)
        const [loadedData, projectResult] = await Promise.all([
          loadDataBlocks({
            message,
            ragQuery: routerResult.rag_query,
            dataNeeded: specialistDataNeeded,
            relevantProjectIds,
            project_id,
            conversation_id: convId,
          }),
          project_id
            ? supabaseAdmin.from('projects').select('system_prompt').eq('id', project_id).single()
            : Promise.resolve({ data: null }),
        ])

        console.log('[Chat] data loaded')

        // Determine active artifact — check if named in the message
        const artifacts = loadedData.artifacts || []
        let effectiveActiveArtifactId = active_artifact_id
        if (!effectiveActiveArtifactId && artifacts.length > 0) {
          const msgLower = message.toLowerCase()
          const named = artifacts.find((a: any) => msgLower.includes(a.name.toLowerCase()))
          if (named) effectiveActiveArtifactId = named.id
        }

        // Build tools from the union of all active specialists' tools.
        // request_additional_context is always included.
        const activeToolNames = [...new Set(activeSpecialists.flatMap((s: SpecialistDefinition) => s.tools))]
        const activeTools: Anthropic.Messages.Tool[] = [
          ...activeToolNames.map(name => ALL_TOOLS_MAP[name]).filter((t): t is Anthropic.Messages.Tool => !!t),
          REQUEST_ADDITIONAL_CONTEXT_TOOL,
        ]
        console.log(`[Chat] tools: [${activeToolNames.join(', ')}] | total: ${activeTools.length}`)

        // Drop short trailing assistant messages — likely a partial/failed previous response
        if (history && history.length > 0) {
          const last = history[history.length - 1]
          if (last.role === 'assistant' && (last.content || '').length < 20) {
            history.splice(history.length - 1, 1)
          }
        }

        // Build the Pacific time string for the prompt
        const pacificTime = new Date().toLocaleString('en-US', {
          timeZone: 'America/Los_Angeles',
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        })

        console.log('[Chat] building system prompt')
        const systemPrompt = buildSpecialistPrompt(activeSpecialists, loadedData, {
          previousSessionSummary: previousSummary,
          currentTime: pacificTime,
          relevantProjects: routerResult.relevant_projects.length > 0 ? routerResult.relevant_projects : undefined,
          projectSystemPrompt: projectResult.data?.system_prompt || null,
          activeArtifactId: effectiveActiveArtifactId,
          trainingContext: loadedData.training,
        })

        // Build messages array, capped by character budget
        const HISTORY_CHAR_BUDGET = 40000
        let historyCharCount = 0
        const trimmedHistory = (history || []).reduceRight((acc: any[], m: any) => {
          const len = (m.content || '').length
          if (historyCharCount + len > HISTORY_CHAR_BUDGET) return acc
          historyCharCount += len
          acc.unshift(m)
          return acc
        }, [])

        // Collapse consecutive same-role messages
        const deduped = trimmedHistory.reduce((acc: any[], m: any) => {
          if (acc.length > 0 && acc[acc.length - 1].role === m.role) return acc
          acc.push(m)
          return acc
        }, [])
        while (deduped.length > 0 && deduped[0].role !== 'user') deduped.shift()
        while (deduped.length > 0 && deduped[deduped.length - 1].role !== 'user') deduped.pop()

        const chatMessages: Anthropic.Messages.MessageParam[] = deduped.map((m: any) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }))


        // Keep the raw RAG query for request_additional_context fallback
        const ragQuery = routerResult.rag_query || message

        let currentMessages = [...chatMessages]
        let continueLoop = true
        let toolCallCount = 0
        let streamAttempt = 0

        while (continueLoop) {
          continueLoop = false
          streamAttempt++

          if (toolCallCount >= 8) {
            currentMessages = [
              ...currentMessages,
              {
                role: 'user' as const,
                content: "You've used 8 tools on this message. Wrap up your response with what you have.",
              },
            ]
          }

          const abortController = new AbortController()
          const timeoutId = setTimeout(() => abortController.abort(), 30000)

          console.log('[Chat] calling OpenRouter, model:', selectedModel, 'tools:', activeTools.length, 'msgs:', currentMessages.length, 'attempt:', streamAttempt, 'system_len:', systemPrompt.length)

          let response: ReturnType<typeof anthropic.messages.stream>
          try {
            response = anthropic.messages.stream({
              model: selectedModel,
              max_tokens: 4096,
              system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }] as any,
              messages: currentMessages,
              tools: toolCallCount >= 8 ? [] : activeTools,
              ...({ extra_body: { models: ['anthropic/claude-sonnet-4.6:exacto', 'google/gemini-3.1-pro-preview'], provider: { sort: 'latency' } } } as any),
            })
          } catch (streamInitErr: any) {
            clearTimeout(timeoutId)
            console.error('[Chat] stream init error:', streamInitErr?.message)
            if (streamAttempt === 1) {
              currentMessages = chatMessages.slice(-5)
              streamAttempt = 2
              continueLoop = true
              continue
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: "I ran into a connection issue. Please try again." })}\n\n`))
            break
          }

          let streamError: Error | null = null
          response.on('error', (err: any) => {
            const errDetail = JSON.stringify({ message: err?.message, status: err?.status, error: err?.error, body: err?.body })
            console.error('Stream-level error:', errDetail)
            // Write to DB so we can read it even when Vercel logs truncate
            streamError = err
          })

          const contentBlocks: Anthropic.Messages.ContentBlockParam[] = []
          let currentTextBlock = ''
          let currentToolUse: { id: string; name: string; inputJson: string } | null = null

          try {
            for await (const event of response) {
              if (abortController.signal.aborted) {
                console.warn('[Chat] stream aborted (30s timeout)')
                break
              }
              if (event.type === 'content_block_start') {
                if (event.content_block.type === 'text') {
                  if (fullResponse.length > 0 && !/\s$/.test(fullResponse)) {
                    fullResponse += ' '
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: ' ' })}\n\n`))
                  }
                  currentTextBlock = ''
                } else if (event.content_block.type === 'tool_use') {
                  currentToolUse = {
                    id: event.content_block.id,
                    name: event.content_block.name,
                    inputJson: '',
                  }
                }
              } else if (event.type === 'content_block_delta') {
                if (event.delta.type === 'text_delta') {
                  currentTextBlock += event.delta.text
                  fullResponse += event.delta.text
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`))
                } else if (event.delta.type === 'input_json_delta' && currentToolUse) {
                  currentToolUse.inputJson += event.delta.partial_json
                }
              } else if (event.type === 'content_block_stop') {
                if (currentToolUse) {
                  let toolInput: any
                  try {
                    toolInput = JSON.parse(currentToolUse.inputJson || '{}')
                  } catch (_parseErr) {
                    console.error('Tool input JSON parse failed for', currentToolUse.name, '- partial input:', currentToolUse.inputJson)
                    toolInput = {}
                  }
                  contentBlocks.push({
                    type: 'tool_use',
                    id: currentToolUse.id,
                    name: currentToolUse.name,
                    input: toolInput,
                  } as Anthropic.Messages.ContentBlock)

                  const statusLabel = toolStatusLabels[currentToolUse.name] || 'Working'
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ tool_status: statusLabel })}\n\n`))

                  let toolResult: any
                  if (currentToolUse.name === 'manage_artifact') {
                    toolResult = await executeArtifactTool(toolInput, convId, project_id)
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      artifact: { operation: toolInput.operation, artifact: toolResult.artifact },
                    })}\n\n`))
                  } else if (currentToolUse.name === 'manage_project_context') {
                    toolResult = await executeManageProjectContext(toolInput)
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ project_context: toolResult })}\n\n`))
                  } else if (currentToolUse.name === 'search_gmail') {
                    try {
                      const emails = await searchEmails(toolInput.query, toolInput.max_results || 10)

                      const { data: outboundThreads } = await supabaseAdmin
                        .from('email_threads')
                        .select('gmail_thread_id, last_sender_email, subject, last_message_date')
                        .eq('direction', 'outbound')
                        .eq('response_detected', false)
                        .gte('last_message_date', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())

                      if (outboundThreads && outboundThreads.length > 0) {
                        const stopWords = new Set(['re:', 'fwd:', 'fw:', 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'between', 'through', 'after', 'before', 'above', 'below', 'and', 'but', 'or', 'not', 'no', 'so', 'if', 'then', 'than', 'that', 'this', 'it', 'its', 'my', 'your', 'his', 'her', 'our', 'their', 'i', 'you', 'he', 'she', 'we', 'they', 'me', 'him', 'us', 'them', 'up', 'out', 'just', 'also', 'very', 'all', 'any', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'only', 'same', 'new', 'old', 'hi', 'hello', 'hey', 'thanks', 'thank', 'please', 'regards'])
                        const extractKeywords = (text: string): Set<string> => new Set(
                          text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
                            .filter(w => w.length > 2 && !stopWords.has(w))
                        )
                        const extractDomain = (email: string): string => {
                          const match = email.match(/@([^>]+)/)
                          return match ? match[1].toLowerCase() : ''
                        }
                        const outboundData = outboundThreads.map(t => ({
                          ...t,
                          recipientDomain: extractDomain(t.last_sender_email || ''),
                          keywords: extractKeywords(t.subject || ''),
                        }))
                        for (const email of emails) {
                          const senderDomain = extractDomain(email.from || '')
                          const emailKeywords = extractKeywords(`${email.subject || ''} ${email.snippet || ''}`)
                          for (const thread of outboundData) {
                            let matched = false
                            if (email.threadId && email.threadId === thread.gmail_thread_id) matched = true
                            if (!matched && senderDomain && thread.recipientDomain && senderDomain === thread.recipientDomain) matched = true
                            if (!matched && thread.keywords.size > 0) {
                              let overlap = 0
                              for (const kw of thread.keywords) { if (emailKeywords.has(kw)) overlap++ }
                              if (overlap >= 2) matched = true
                            }
                            if (matched) {
                              const sentDate = new Date(thread.last_message_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' })
                              email.snippet += `\n[CONTEXT: This appears to be related to your outbound email about "${thread.subject}" sent on ${sentDate}. You were waiting for a reply on this.]`
                              break
                            }
                          }
                        }
                      }

                      toolResult = { status: 'ok', result_count: emails.length, emails }
                    } catch (e: any) {
                      toolResult = { status: 'error', message: e.message }
                    }
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      gmail_search: { query: toolInput.query, result_count: toolResult.result_count || 0, error: toolResult.status === 'error' ? toolResult.message : undefined },
                    })}\n\n`))
                  } else if (currentToolUse.name === 'draft_email') {
                    try {
                      const result = await createDraft(toolInput.to, toolInput.subject, toolInput.body, toolInput.cc)
                      toolResult = { status: 'drafted', draft_id: result.id, message: result.message }
                    } catch (e: any) {
                      toolResult = { status: 'error', message: e.message }
                    }
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      email_draft: { to: toolInput.to, subject: toolInput.subject, status: toolResult.status, message: toolResult.message },
                    })}\n\n`))
                  } else if (currentToolUse.name === 'manage_project') {
                    toolResult = await executeProjectTool(toolInput)
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      project: { operation: toolInput.operation, project: toolResult.project, status: toolResult.status, message: toolResult.message },
                    })}\n\n`))
                  } else if (currentToolUse.name === 'manage_bookmarks') {
                    toolResult = await executeBookmarkTool(toolInput)
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      bookmark: { operation: toolInput.operation, bookmark: toolResult.bookmark, bookmarks: toolResult.bookmarks, status: toolResult.status, message: toolResult.message },
                    })}\n\n`))
                  } else if (currentToolUse.name === 'manage_dashboard') {
                    toolResult = await executeDashboardCardTool(toolInput)
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      dashboard_card: { operation: toolInput.operation, card: toolResult.card, status: toolResult.status, message: toolResult.message },
                    })}\n\n`))
                  } else if (currentToolUse.name === 'manage_notification_rules') {
                    toolResult = await executeNotificationRuleTool(toolInput)
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      notification_rule: { operation: toolInput.operation, rule: toolResult.rule, rules: toolResult.rules, status: toolResult.status, message: toolResult.message },
                    })}\n\n`))
                  } else if (currentToolUse.name === 'manage_preferences') {
                    toolResult = await executePreferencesTool(toolInput)
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      preference: { key: toolInput.key, value: toolResult.value, status: toolResult.status },
                    })}\n\n`))
                  } else if (currentToolUse.name === 'manage_training') {
                    toolResult = await executeTrainingTool(toolInput)
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      training: { operation: toolInput.operation, result: toolResult },
                    })}\n\n`))
                  } else if (currentToolUse.name === 'manage_notepad') {
                    toolResult = await executeNotepadTool(toolInput)
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ notepad: { operation: toolInput.operation, result: toolResult } })}\n\n`))
                  } else if (currentToolUse.name === 'manage_contacts') {
                    toolResult = await executeContactsTool(toolInput)
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ contact: { operation: toolInput.operation, result: toolResult } })}\n\n`))
                  } else if (currentToolUse.name === 'search_web') {
                    try {
                      const result = await executeWebSearch(toolInput.query)
                      toolResult = { status: 'ok', result }
                    } catch (e: any) {
                      toolResult = { status: 'error', message: e.message }
                    }
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      web_search: { query: toolInput.query, result: toolResult.result || toolResult.message },
                    })}\n\n`))
                  } else if (currentToolUse.name === 'spawn_background_job') {
                    try {
                      const job = await spawnBackgroundJob(
                        convId,
                        toolInput.job_type || 'research',
                        toolInput.prompt,
                        'user',
                        { topic_summary: toolInput.topic_summary }
                      )
                      toolResult = {
                        status: 'spawned',
                        job_id: job.id,
                        message: `Background job started. I'll dig into "${toolInput.topic_summary}" and post results in this chat when done.`,
                      }
                    } catch (e: any) {
                      toolResult = { status: 'error', message: e.message }
                    }
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      background_job: { status: toolResult.status, topic: toolInput.topic_summary, job_id: toolResult.job_id },
                    })}\n\n`))
                  } else if (currentToolUse.name === 'create_watch') {
                    toolResult = await executeCreateWatch(toolInput)
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ watch: { operation: 'create', result: toolResult } })}\n\n`))
                  } else if (currentToolUse.name === 'list_watches') {
                    toolResult = await executeListWatches()
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ watch: { operation: 'list', result: toolResult } })}\n\n`))
                  } else if (currentToolUse.name === 'cancel_watch') {
                    toolResult = await executeCancelWatch(toolInput)
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ watch: { operation: 'cancel', result: toolResult } })}\n\n`))
                  } else if (currentToolUse.name === 'check_calendar') {
                    toolResult = await executeCheckCalendar(toolInput)
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ calendar: { operation: 'check', result: toolResult } })}\n\n`))
                  } else if (currentToolUse.name === 'find_availability') {
                    toolResult = await executeFindAvailability(toolInput)
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ calendar: { operation: 'availability', result: toolResult } })}\n\n`))
                  } else if (currentToolUse.name === 'create_calendar_event') {
                    toolResult = await executeCreateCalendarEvent(toolInput)
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ calendar: { operation: 'create', result: toolResult } })}\n\n`))
                  } else if (currentToolUse.name === 'ask_structured_question') {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      structured_question: { questions: toolInput.questions },
                    })}\n\n`))
                    toolResult = { status: 'ok', message: 'Questions presented to user. Waiting for response.' }
                  } else if (currentToolUse.name === 'quick_confirm') {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      quick_confirm: {
                        prompt: toolInput.prompt,
                        confirm_label: toolInput.confirm_label || 'Yes',
                        deny_label: toolInput.deny_label || 'No',
                      },
                    })}\n\n`))
                    toolResult = { status: 'ok', message: 'Confirmation prompt presented to user. Waiting for response.' }
                  } else if (currentToolUse.name === 'query_sales') {
                    toolResult = await executeQuerySales(toolInput)
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ sales_query: { status: toolResult.status, row_count: toolResult.rows?.length || 0 } })}\n\n`))
                  } else if (currentToolUse.name === 'search_texts') {
                    toolResult = await executeSearchTexts(toolInput)
                  } else if (currentToolUse.name === 'manage_text_contacts') {
                    toolResult = await executeManageTextContacts(toolInput)
                  } else if (currentToolUse.name === 'manage_group_whitelist') {
                    toolResult = await executeManageGroupWhitelist(toolInput)
                  } else if (currentToolUse.name === 'request_additional_context') {
                    const requestedBlocks: string[] = toolInput.data_blocks || []
                    console.log(`[Chat] request_additional_context: [${requestedBlocks.join(', ')}] — reason: ${toolInput.reason || '(none)'}`)

                    // Find which specialists own the requested data blocks
                    const relevantSpecialists: SpecialistDefinition[] = []
                    for (const block of requestedBlocks) {
                      for (const specialist of specialistRegistry.values()) {
                        if (specialist.dataNeeded.includes(block) && !relevantSpecialists.find(s => s.id === specialist.id)) {
                          relevantSpecialists.push(specialist)
                        }
                      }
                    }

                    const additionalDataNeeded = new Set(requestedBlocks)
                    const additionalData = await loadDataBlocks({
                      message,
                      ragQuery: ragQuery !== message ? ragQuery : undefined,
                      dataNeeded: additionalDataNeeded,
                      relevantProjectIds,
                      project_id,
                      conversation_id: convId,
                    })

                    toolResult = {
                      status: 'ok',
                      loaded: requestedBlocks,
                      data: additionalData,
                      message: `Loaded additional context for: ${requestedBlocks.join(', ')}. Use the data above to answer the question.`,
                    }
                  } else {
                    // Default: manage_action_items
                    toolResult = await executeActionItemTool(toolInput, convId, loadedData.action_items || [])
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      action_item: { operation: toolInput.operation, result: toolResult },
                    })}\n\n`))
                  }

                  currentMessages = [
                    ...currentMessages,
                    { role: 'assistant' as const, content: contentBlocks },
                    {
                      role: 'user' as const,
                      content: [{
                        type: 'tool_result' as const,
                        tool_use_id: currentToolUse.id,
                        content: JSON.stringify(toolResult),
                      }],
                    },
                  ]

                  toolCallCount++
                  const stopAfterTool = currentToolUse.name === 'ask_structured_question' || currentToolUse.name === 'quick_confirm'
                  currentToolUse = null
                  continueLoop = !stopAfterTool && toolCallCount < 8
                } else if (currentTextBlock) {
                  contentBlocks.push({ type: 'text', text: currentTextBlock })
                  currentTextBlock = ''
                }
              }
            }
          } catch (iterErr: any) {
            clearTimeout(timeoutId)
            const isTimeout = abortController.signal.aborted || iterErr?.name === 'AbortError'
            const iterErrDetail = JSON.stringify({ message: iterErr?.message, name: iterErr?.name, status: iterErr?.status, error: iterErr?.error })
            console.error('[Chat] stream iteration error (attempt', streamAttempt, '):', iterErrDetail)
            await supabaseAdmin.from('notes').insert({ title: 'DEBUG iter error', content: iterErrDetail.slice(0, 2000) })

            if (streamAttempt === 1) {
              console.log('[Chat] retrying with simplified context')
              currentMessages = chatMessages.slice(-5)
              toolCallCount = 0
              streamAttempt = 2
              continueLoop = true
              continue
            }

            const errorText = isTimeout
              ? "I got cut off — let me try that again with a simpler approach."
              : "I ran into a connection issue. Please try sending that again."
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: errorText })}\n\n`))
            fullResponse = errorText
            isErrorResponse = true
            break
          }
          clearTimeout(timeoutId)

          const deferredStreamError: Error | null = streamError
          if (deferredStreamError) {
            const deferredDetail = JSON.stringify({ message: (deferredStreamError as any)?.message, status: (deferredStreamError as any)?.status, error: (deferredStreamError as any)?.error })
            console.error('[Chat] deferred stream error after iteration (attempt', streamAttempt, '):', deferredDetail)
            if (streamAttempt === 1) {
              currentMessages = chatMessages.slice(-5)
              toolCallCount = 0
              streamAttempt = 2
              continueLoop = true
              continue
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: "I ran into a connection issue. Please try sending that again." })}\n\n`))
            fullResponse = "I ran into a connection issue. Please try sending that again."
            isErrorResponse = true
            break
          }
        }

        // Don't save error responses — they'd pollute conversation history and confuse future responses
        if (isErrorResponse) return

        // Save assistant message with specialist IDs as context_domains
        const chunks = loadedData._raw_chunks || []
        const sources = chunks.map((c: any) => ({
          document_id: c.document_id,
          chunk_content: c.content.slice(0, 200),
          similarity_score: c.similarity,
        }))

        await supabaseAdmin.from('messages').insert({
          conversation_id: convId,
          role: 'assistant',
          content: fullResponse,
          sources,
          ...(sessionId ? { session_id: sessionId } : {}),
          context_domains: activeSpecialists.map(s => s.id),
        })

        if (sessionId) void supabaseAdmin.rpc('increment_session_message_count', { session_id_param: sessionId, increment_by: 2 })

        await supabaseAdmin
          .from('conversations')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', convId)

        const { data: recentMemory } = await supabaseAdmin
          .from('memories')
          .select('id')
          .gte('created_at', new Date(Date.now() - 5000).toISOString())
          .limit(1)
        if (!recentMemory || recentMemory.length === 0) {
          await extractMemories(convId, message, fullResponse)
        } else {
          console.log('[Chat] skipping memory extraction — recent extraction within 5s')
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, conversation_id: convId, sources })}\n\n`))
        controller.close()
      } catch (error) {
        const errMsg = error instanceof Error ? `${error.name}: ${error.message}` : JSON.stringify(error)
        console.error('[Chat] error name:', error instanceof Error ? error.name : typeof error)
        console.error('[Chat] error msg:', error instanceof Error ? error.message : String(error))
        console.error('[Chat] error full:', errMsg)
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Failed to generate response', debug: errMsg })}\n\n`))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
