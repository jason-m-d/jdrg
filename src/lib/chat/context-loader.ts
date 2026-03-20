/**
 * Specialist-aware context loader.
 *
 * Instead of loading all data unconditionally, this loader reads only the
 * data blocks that the active specialists actually need. The result is a
 * Record<string, any> keyed by data block name (matching RouterResult.data_needed).
 */

import { supabaseAdmin } from '@/lib/supabase'
import {
  retrieveRelevantChunks,
  getPinnedDocuments,
  getRelevantMemories,
  retrieveRelevantContextChunks,
  buildContext,
  retrieveRelevantDecisions,
} from '@/lib/rag'
import { generateQueryEmbedding } from '@/lib/embeddings'
import { buildFewShotBlock } from '@/lib/training'
import type { SpecialistDefinition } from '@/lib/specialists/types'

export interface ContextLoaderOptions {
  /** The user's message text (used for RAG queries) */
  message: string
  /** Rewritten query from the router — keyword-rich, better for semantic search */
  ragQuery?: string | null
  /** Data blocks the active specialists need */
  dataNeeded: Set<string>
  /** Project IDs to scope RAG retrieval to */
  relevantProjectIds?: string[]
  /** The explicit project the user is viewing in the UI (overrides router-detected project for RAG) */
  project_id?: string | null
  /** Conversation ID — needed for artifact loading */
  conversation_id?: string | null
}

/**
 * Load only the data blocks that the active specialists need.
 * Returns a Record<string, any> keyed by data block name.
 */
export async function loadSpecialistData(
  specialists: SpecialistDefinition[],
  message: string,
  ragQuery?: string | null,
  options?: Omit<ContextLoaderOptions, 'message' | 'ragQuery' | 'dataNeeded'>,
): Promise<Record<string, any>> {
  // Build a unified set of data blocks needed across all active specialists
  const dataNeeded = new Set<string>()
  for (const specialist of specialists) {
    for (const block of specialist.dataNeeded) {
      dataNeeded.add(block)
    }
  }

  return loadDataBlocks({
    message,
    ragQuery,
    dataNeeded,
    ...options,
  })
}

/**
 * Load specific data blocks directly from a Set.
 * Used both by loadSpecialistData and by the chat route when it needs
 * fine-grained control (e.g. for request_additional_context).
 */
export async function loadDataBlocks(options: ContextLoaderOptions): Promise<Record<string, any>> {
  const {
    message,
    ragQuery,
    dataNeeded,
    relevantProjectIds = [],
    project_id = null,
    conversation_id = null,
  } = options

  const effectiveRagQuery = ragQuery || message
  const needsRag =
    dataNeeded.has('documents_rag') ||
    dataNeeded.has('context_chunks') ||
    dataNeeded.has('memories') ||
    dataNeeded.has('decisions')

  // Generate query embedding only when RAG is actually needed
  const queryEmbedding = needsRag
    ? await generateQueryEmbedding(effectiveRagQuery).catch(e => {
        console.error('Query embedding failed:', e.message)
        return undefined
      })
    : undefined

  // Determine project scoping for RAG
  // If the user is viewing a specific project (project_id), scope to that.
  // Otherwise use the router's detected relevant projects.
  const ragProjectId =
    project_id ||
    (relevantProjectIds.length === 1 ? relevantProjectIds[0] : null)

  // Run all needed data fetches in parallel
  const [
    chunks,
    pinnedDocs,
    memories,
    contextChunks,
    actionItemsResult,
    actionItemsCriticalResult,
    projectsResult,
    artifactsResult,
    contactsResult,
    notesResult,
    dashboardCardsResult,
    notificationRulesResult,
    uiPreferencesResult,
    trainingContext,
    relevantDecisions,
    awaitingRepliesResult,
    activeWatchesResult,
    calendarEventsResult,
    recentTextsResult,
    salesResult,
  ] = await Promise.all([
    // documents_rag — scoped to relevant project(s)
    dataNeeded.has('documents_rag')
      ? (relevantProjectIds.length > 1
          ? Promise.all(
              relevantProjectIds.map(pid =>
                retrieveRelevantChunks(effectiveRagQuery, pid, 5, 0.7, queryEmbedding).catch(() => [])
              )
            ).then(results => results.flat())
          : retrieveRelevantChunks(effectiveRagQuery, ragProjectId ?? undefined, 8, 0.7, queryEmbedding).catch(e => {
              console.error('RAG retrieval failed:', e.message)
              return []
            }))
      : Promise.resolve([]),

    // pinned docs — always load for current project
    project_id ? getPinnedDocuments(project_id) : Promise.resolve([]),

    // memories
    dataNeeded.has('memories')
      ? getRelevantMemories(effectiveRagQuery)
      : Promise.resolve([]),

    // context_chunks
    dataNeeded.has('context_chunks')
      ? (relevantProjectIds.length > 1
          ? Promise.all(
              relevantProjectIds.map(pid =>
                retrieveRelevantContextChunks(effectiveRagQuery, pid, 3, 0.7, queryEmbedding).catch(() => [])
              )
            ).then(results => results.flat())
          : retrieveRelevantContextChunks(effectiveRagQuery, ragProjectId ?? undefined, 5, 0.7, queryEmbedding).catch(e => {
              console.error('Context retrieval failed:', e.message)
              return []
            }))
      : Promise.resolve([]),

    // action_items — full list, only when router activates tasks specialist
    dataNeeded.has('action_items')
      ? supabaseAdmin
          .from('action_items')
          .select('*')
          .in('status', ['pending', 'approved'])
          .order('created_at', { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [] }),

    // action_items_critical — always-on: high-priority, overdue, or due within 24h
    dataNeeded.has('action_items_critical')
      ? Promise.all([
          supabaseAdmin
            .from('action_items')
            .select('*')
            .in('status', ['pending', 'approved'])
            .or(`priority.eq.high,due_date.lt.${new Date().toISOString()},due_date.lte.${new Date(Date.now() + 24 * 3600000).toISOString()}`)
            .or('snoozed_until.is.null,snoozed_until.lte.' + new Date().toISOString())
            .order('created_at', { ascending: false })
            .limit(10),
          supabaseAdmin
            .from('action_items')
            .select('id', { count: 'exact', head: true })
            .in('status', ['pending', 'approved']),
        ]).then(([itemsResult, countResult]) => ({
          items: itemsResult.data || [],
          totalCount: countResult.count || 0,
        }))
      : Promise.resolve({ items: [], totalCount: 0 }),

    // projects
    dataNeeded.has('projects')
      ? supabaseAdmin.from('projects').select('id, name, description').order('name')
      : Promise.resolve({ data: [] }),

    // artifacts — global, not scoped to conversation
    dataNeeded.has('artifacts')
      ? supabaseAdmin
          .from('artifacts')
          .select('id, name, type, content, version, updated_at, conversation_id, project_id')
          .order('updated_at', { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] }),

    // contacts
    dataNeeded.has('contacts')
      ? supabaseAdmin.from('contacts').select('*').order('name')
      : Promise.resolve({ data: [] }),

    // notes
    dataNeeded.has('notes')
      ? supabaseAdmin
          .from('notes')
          .select('*')
          .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),

    // dashboard_cards
    dataNeeded.has('dashboard_cards')
      ? supabaseAdmin.from('dashboard_cards').select('*').eq('is_active', true).order('position')
      : Promise.resolve({ data: [] }),

    // notification_rules
    dataNeeded.has('notification_rules')
      ? supabaseAdmin.from('notification_rules').select('*').eq('is_active', true).order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),

    // ui_preferences
    dataNeeded.has('ui_preferences')
      ? supabaseAdmin.from('ui_preferences').select('*')
      : Promise.resolve({ data: [] }),

    // training
    dataNeeded.has('training')
      ? buildFewShotBlock(effectiveRagQuery, queryEmbedding).catch(e => {
          console.error('Training context failed:', e.message)
          return null
        })
      : Promise.resolve(null),

    // decisions (RAG)
    dataNeeded.has('decisions')
      ? retrieveRelevantDecisions(effectiveRagQuery, 5, 0.7, queryEmbedding).catch(e => {
          console.error('Decision retrieval failed:', e.message)
          return []
        })
      : Promise.resolve([]),

    // emails_awaiting
    dataNeeded.has('emails_awaiting')
      ? supabaseAdmin
          .from('email_threads')
          .select('last_sender_email, subject, last_message_date')
          .eq('direction', 'outbound')
          .eq('response_detected', false)
          .gte('last_message_date', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
          .order('last_message_date', { ascending: false })
      : Promise.resolve({ data: [] }),

    // watches — core specialist is always_on so this always loads
    dataNeeded.has('watches')
      ? supabaseAdmin
          .from('conversation_watches')
          .select('id, watch_type, context, priority, created_at, match_criteria')
          .eq('status', 'active')
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] }),

    // calendar
    dataNeeded.has('calendar')
      ? supabaseAdmin
          .from('calendar_events')
          .select('title, start_time, end_time, all_day, location, attendees, organizer_email, status')
          .gte('start_time', new Date().toISOString())
          .lte('start_time', new Date(Date.now() + 48 * 3600000).toISOString())
          .order('start_time', { ascending: true })
      : Promise.resolve({ data: [] }),

    // texts
    dataNeeded.has('texts')
      ? supabaseAdmin
          .from('text_messages')
          .select('contact_name, phone_number, message_text, service, message_date, is_from_me, is_group_chat, group_chat_name, flag_reason')
          .eq('flagged', true)
          .eq('is_from_me', false)
          .gte('message_date', new Date(Date.now() - 48 * 3600000).toISOString())
          .order('message_date', { ascending: false })
          .limit(15)
      : Promise.resolve({ data: [] }),

    // sales — returned as null/empty since query_sales tool fetches data dynamically at runtime
    // The sales specialist activates to provide instructions and the tool, not pre-loaded data
    Promise.resolve({ data: [] }),
  ])

  // Build the document context string from chunks + pinned docs
  const rawContext = buildContext(chunks, pinnedDocs, memories, contextChunks)
  const documentContext = rawContext.length > 4000
    ? rawContext.slice(0, 4000) + '\n[...document context truncated for length...]'
    : rawContext || null

  // Normalize email replies shape
  const awaitingReplies = ((awaitingRepliesResult as any).data || []).map((r: any) => ({
    recipient_email: r.last_sender_email,
    subject: r.subject,
    last_message_date: r.last_message_date,
  }))

  return {
    documents_rag: documentContext,
    context_chunks: documentContext,  // same built context — specialist checks whichever key it uses
    memories,
    action_items: actionItemsResult.data || [],
    action_items_critical: actionItemsCriticalResult,
    projects: projectsResult.data || [],
    artifacts: artifactsResult.data || [],
    contacts: contactsResult.data || [],
    notes: notesResult.data || [],
    dashboard_cards: dashboardCardsResult.data || [],
    notification_rules: notificationRulesResult.data || [],
    ui_preferences: uiPreferencesResult.data || [],
    training: trainingContext,
    decisions: relevantDecisions,
    emails_awaiting: awaitingReplies,
    watches: activeWatchesResult.data || [],
    calendar: calendarEventsResult.data || [],
    texts: recentTextsResult.data || [],
    sales: salesResult.data || [],
    // Raw chunks preserved for sources metadata (not injected into the prompt)
    _raw_chunks: chunks,
  }
}
