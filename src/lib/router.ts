/**
 * AI-powered message router.
 *
 * Replaces the regex-based classifyIntent() with a Gemini Flash Lite call that
 * determines exactly what data blocks and tools are needed for each message.
 * Falls back to classifyIntent() if the router call fails or times out.
 */

import { openrouterClient } from '@/lib/openrouter'
import { classifyIntent, getToolsForDomains } from '@/lib/intent-classifier'
import { logRouterDecision } from '@/lib/activity-log'
import { BACKGROUND_LITE_MODELS, buildMetadata } from '@/lib/openrouter-models'

export interface RouterResult {
  intent: string
  data_needed: string[]
  tools_needed: string[]
  rag_query: string | null
  complexity: 'low' | 'medium' | 'high'
  relevant_projects: string[]
}

export interface RouterMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface RouterProject {
  id: string
  name: string
  description: string | null
}

const ROUTER_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string' },
    data_needed: {
      type: 'array',
      items: {
        type: 'string',
        enum: [
          'action_items', 'action_items_critical', 'projects', 'artifacts', 'memories', 'documents_rag',
          'context_chunks', 'contacts', 'notes', 'calendar', 'emails_awaiting',
          'watches', 'dashboard_cards', 'notification_rules', 'ui_preferences',
          'training', 'decisions', 'texts', 'sales',
        ],
      },
    },
    tools_needed: {
      type: 'array',
      items: {
        type: 'string',
        enum: [
          'manage_action_items', 'manage_artifact', 'manage_project',
          'manage_project_context', 'manage_notepad', 'search_web',
          'spawn_background_job', 'ask_structured_question', 'quick_confirm',
          'manage_training', 'create_watch', 'list_watches', 'cancel_watch',
          'manage_contacts', 'search_gmail', 'draft_email', 'check_calendar',
          'find_availability', 'create_calendar_event', 'manage_dashboard',
          'manage_notification_rules', 'manage_preferences', 'query_sales',
          'search_texts', 'manage_text_contacts', 'manage_group_whitelist',
          'manage_bookmarks', 'search_conversation_history', 'get_activity_log',
        ],
      },
    },
    rag_query: { type: ['string', 'null'] },
    complexity: { type: 'string', enum: ['low', 'medium', 'high'] },
    relevant_projects: { type: 'array', items: { type: 'string' } },
  },
  required: ['intent', 'data_needed', 'tools_needed', 'rag_query', 'complexity', 'relevant_projects'],
  additionalProperties: false,
}

const ROUTER_SYSTEM_PROMPT = `You are a message router for an AI executive assistant app called Crosby. Your job is to analyze the user's message and determine exactly what data and tools are needed to respond. Be precise - only request what's actually needed. A greeting needs nothing. A question about email needs email tools and emails_awaiting data. A question about store performance needs sales data and the query_sales tool. When multiple topics are mentioned, include data/tools for all of them. The rag_query should be a rewritten version of the user's message optimized for semantic search against the user's documents and project context - make it keyword-rich and specific. Set it to null for greetings, simple questions, or messages that clearly don't need document retrieval. For relevant_projects: identify which projects this message likely relates to based on topic, keywords, or explicit mentions. The active projects will be provided to you. This is critical for two things: (1) scoping RAG retrieval to the right project's documents, and (2) triggering the assistant to ask about saving conversation context to that project. Include search_conversation_history in tools_needed when the message references past conversations or asks about something discussed before (e.g. "what did we talk about", "go back to", "remember when", "earlier you said", "what I said about", "our conversation about", "you mentioned"). Include get_activity_log in tools_needed when the user asks what Crosby has been doing, what crons ran, recent errors, system activity, or whether a background job succeeded. Include manage_artifact in tools_needed when the user asks to create or update any document, plan, checklist, spec, or artifact (e.g. "make a checklist", "create a plan", "draft a spec", "update the plan"). Include open_artifact in tools_needed when the user asks to open, show, view, or find a specific existing artifact by name (e.g. "show me the van nuys plan", "open the closure plan", "pull up that checklist").

ACTION ITEMS / TASKS: Include 'action_items' in data_needed and 'manage_action_items' in tools_needed when the message asks about action items, tasks, to-dos, what's pending, what's on the user's plate, priorities, or open delegations (e.g. "what are my action items?", "show my tasks", "what's on my plate?", "anything pending?", "what should I focus on?", "show me the action item ui").

SEARCH_WEB SIGNAL: Include 'search_web' in tools_needed when the message involves any of the following: current events, news, or anything time-sensitive ("latest", "current", "today", "this week", "right now"); prices, ticket availability, hours, or anything that changes frequently; addresses, locations, directions, or "where is X"; looking up a specific business, venue, person, product, or app that Crosby may not know about; anything the user is explicitly asking to "look up", "find", "search for", or "check" externally; questions about real-world facts that may have changed (stock prices, sports scores, event schedules, business info). When in doubt, include search_web.`

/**
 * Route a message using the AI router. Returns a RouterResult with exactly what
 * data and tools are needed. Falls back to classifyIntent() on timeout or error.
 *
 * @param model - Override the router model. Defaults to gemini-3.1-flash-lite-preview.
 *                Use a cheaper model (e.g. openai/gpt-4.1-nano) for speculative prefetch calls.
 */
export async function routeMessage(
  message: string,
  recentMessages: RouterMessage[],
  activeProjects: RouterProject[] = [],
  model?: string,
): Promise<RouterResult & { fromFallback?: boolean }> {
  const start = Date.now()
  const routerModel = model || BACKGROUND_LITE_MODELS.primary
  const fallbackModel = model ? undefined : BACKGROUND_LITE_MODELS.fallbacks[0]

  const projectList = activeProjects.length > 0
    ? `\n\nActive projects:\n${activeProjects.map(p => `- ${p.name}${p.description ? `: ${p.description}` : ''}`).join('\n')}`
    : ''

  const contextBlock = recentMessages.length > 0
    ? `\n\nRecent conversation context:\n${recentMessages.map(m => `${m.role}: ${m.content.slice(0, 300)}`).join('\n')}`
    : ''

  const userContent = `Route this message: "${message}"${projectList}${contextBlock}`

  try {
    const result = await Promise.race([
      openrouterClient.chat.completions.create({
        model: routerModel,
        max_tokens: 512,
        messages: [
          { role: 'system', content: ROUTER_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        ...({
          ...(fallbackModel ? { models: [routerModel, fallbackModel] } : { models: [routerModel] }),
          provider: { ...BACKGROUND_LITE_MODELS.provider, require_parameters: true },
          plugins: [{ id: 'response-healing' }],
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'router_result', strict: true, schema: ROUTER_SCHEMA },
          },
          metadata: buildMetadata({ call_type: 'router' }),
        } as any),
      } as any),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Router timeout')), 4000)
      ),
    ])

    const elapsed = Date.now() - start
    const text = result.choices[0]?.message?.content || ''
    console.log(`[Router] ${elapsed}ms | message: "${message.slice(0, 60)}"`)

    let parsed: RouterResult
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error(`Router JSON parse failed: ${text.slice(0, 100)}`)
    }

    void logRouterDecision({
      message_preview: message.slice(0, 80),
      intent: parsed.intent,
      data_needed: parsed.data_needed,
      tools_needed: parsed.tools_needed,
      latency_ms: elapsed,
      from_fallback: false,
    })

    return parsed
  } catch (err: any) {
    const elapsed = Date.now() - start
    const isTimeout = err?.message === 'Router timeout'
    console.warn(`[Router] ${isTimeout ? 'timeout' : 'error'} after ${elapsed}ms — falling back to classifyIntent(). ${err?.message}`)

    const fallback = buildFallbackResult(message)
    void logRouterDecision({
      message_preview: message.slice(0, 80),
      intent: fallback.intent,
      data_needed: fallback.data_needed,
      tools_needed: fallback.tools_needed,
      latency_ms: elapsed,
      from_fallback: true,
    })

    return fallback
  }
}

/**
 * Build a RouterResult from the old regex classifier as a fallback.
 * Maps domains → data_needed and tools_needed so the rest of the chat route
 * can use RouterResult without branching on which path was taken.
 */
function buildFallbackResult(message: string): RouterResult & { fromFallback: true } {
  const domains = classifyIntent(message)
  const tools = getToolsForDomains(domains)

  // Map domain names → data_needed values
  const DATA_MAP: Record<string, string[]> = {
    base: ['action_items_critical', 'projects', 'artifacts', 'watches'],
    actionItems: ['action_items'],
    artifacts: ['artifacts'],
    projects: ['projects'],
    watches: ['watches'],
    training: ['training'],
    email: ['emails_awaiting'],
    calendar: ['calendar'],
    people: ['contacts'],
    contacts: ['contacts'],
    notes: ['notes'],
    texts: ['texts'],
    dashboard: ['dashboard_cards'],
    alerts: ['notification_rules'],
    prefs: ['ui_preferences'],
    sales: ['sales'],
  }

  const dataNededSet = new Set<string>()
  for (const domain of domains) {
    for (const d of DATA_MAP[domain] ?? []) {
      dataNededSet.add(d)
    }
  }

  return {
    intent: message.slice(0, 100),
    data_needed: Array.from(dataNededSet),
    tools_needed: tools,
    rag_query: message.trim().split(/\s+/).length >= 4 ? message : null,
    complexity: 'medium',
    relevant_projects: [],
    fromFallback: true,
  }
}
