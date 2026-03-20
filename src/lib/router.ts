/**
 * AI-powered message router.
 *
 * Replaces the regex-based classifyIntent() with a Gemini Flash Lite call that
 * determines exactly what data blocks and tools are needed for each message.
 * Falls back to classifyIntent() if the router call fails or times out.
 */

import { openrouterClient } from '@/lib/openrouter'
import { classifyIntent, getToolsForDomains } from '@/lib/intent-classifier'

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
          'manage_bookmarks', 'search_conversation_history',
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

const ROUTER_SYSTEM_PROMPT = `You are a message router for an AI executive assistant app called Crosby. Your job is to analyze the user's message and determine exactly what data and tools are needed to respond. Be precise - only request what's actually needed. A greeting needs nothing. A question about email needs email tools and emails_awaiting data. A question about store performance needs sales data and the query_sales tool. When multiple topics are mentioned, include data/tools for all of them. The rag_query should be a rewritten version of the user's message optimized for semantic search against the user's documents and project context - make it keyword-rich and specific. Set it to null for greetings, simple questions, or messages that clearly don't need document retrieval. For relevant_projects: identify which projects this message likely relates to based on topic, keywords, or explicit mentions. The active projects will be provided to you. This is critical for two things: (1) scoping RAG retrieval to the right project's documents, and (2) triggering the assistant to ask about saving conversation context to that project. Include search_conversation_history in tools_needed when the message references past conversations or asks about something discussed before (e.g. "what did we talk about", "go back to", "remember when", "earlier you said", "what I said about", "our conversation about", "you mentioned").`

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
  const routerModel = model || 'google/gemini-3.1-flash-lite-preview'
  const fallbackModel = model ? undefined : 'google/gemini-3-flash-preview'

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
          provider: { sort: 'price' },
          plugins: [{ id: 'response-healing' }],
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'router_result', strict: true, schema: ROUTER_SCHEMA },
          },
        } as any),
      } as any),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Router timeout')), 3000)
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

    return parsed
  } catch (err: any) {
    const elapsed = Date.now() - start
    const isTimeout = err?.message === 'Router timeout'
    console.warn(`[Router] ${isTimeout ? 'timeout' : 'error'} after ${elapsed}ms — falling back to classifyIntent(). ${err?.message}`)

    return buildFallbackResult(message)
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
