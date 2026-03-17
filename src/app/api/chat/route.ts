import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase'
import { retrieveRelevantChunks, getPinnedDocuments, getRelevantMemories, retrieveRelevantContextChunks, buildContext } from '@/lib/rag'
import { generateQueryEmbedding } from '@/lib/voyage'
import { chunkAndEmbedContext } from '@/lib/embed-context'
import { buildSystemPrompt } from '@/lib/system-prompt'
import { searchEmails, createDraft } from '@/lib/gmail'
import { buildFewShotBlock, storeTrainingExample, getTrainingStats } from '@/lib/training'
import { fetchEmails } from '@/lib/gmail'
import type { ActionItem, Artifact, DashboardCard, NotificationRule, Bookmark, UIPreference } from '@/lib/types'
import { sendPushToAll } from '@/lib/push'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const ACTION_ITEM_TOOL: Anthropic.Messages.Tool = {
  name: 'manage_action_items',
  description: 'Create, complete, update, or list action items for Jason. Use this to track important tasks, mark things done, or check what is outstanding.',
  input_schema: {
    type: 'object' as const,
    properties: {
      operation: {
        type: 'string',
        enum: ['create', 'complete', 'update', 'list', 'dismiss', 'snooze'],
        description: 'The operation to perform. dismiss = remove/not relevant. snooze = push back (default +3 days, or specify due_date).',
      },
      title: {
        type: 'string',
        description: 'Title for create operation',
      },
      description: {
        type: 'string',
        description: 'Description for create or update operation',
      },
      priority: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: 'Priority for create or update operation',
      },
      due_date: {
        type: 'string',
        description: 'Due date (YYYY-MM-DD) for create or update operation',
      },
      item_id: {
        type: 'string',
        description: 'Action item ID for complete or update operations',
      },
    },
    required: ['operation'],
  },
}

const ARTIFACT_TOOL: Anthropic.Messages.Tool = {
  name: 'manage_artifact',
  description: 'Create or update an artifact (a named document like a plan, spec, checklist, or freeform note). Artifacts appear in a side panel alongside the chat. Always send the FULL content, not a diff or partial update.',
  input_schema: {
    type: 'object' as const,
    properties: {
      operation: {
        type: 'string',
        enum: ['create', 'update'],
        description: 'Whether to create a new artifact or update an existing one',
      },
      artifact_id: {
        type: 'string',
        description: 'The artifact ID to update (required for update operation)',
      },
      name: {
        type: 'string',
        description: 'Name/title for the artifact',
      },
      content: {
        type: 'string',
        description: 'Full markdown content of the artifact. Always send complete content, never diffs.',
      },
      type: {
        type: 'string',
        enum: ['plan', 'spec', 'checklist', 'freeform'],
        description: 'Type of artifact. Default: freeform',
      },
    },
    required: ['operation', 'name', 'content'],
  },
}

const MANAGE_PROJECT_CONTEXT_TOOL: Anthropic.Messages.Tool = {
  name: 'manage_project_context',
  description: `Add, update, or archive context entries on a project. Use this to keep project knowledge current.
- "create": Add new context from the conversation. Write a thorough summary - this will be retrieved in future conversations.
- "update": Update an existing context entry when new information changes it (e.g. an initiative is completed, a decision changed, new details emerged). Provide the full updated content, not a diff.
- "archive": Mark a context entry as outdated/completed so it stops surfacing in future conversations.
Use proactively when the conversation is clearly relevant to a project - ask Jason first before adding.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      operation: {
        type: 'string',
        enum: ['create', 'update', 'archive'],
        description: 'The operation to perform',
      },
      project_name: {
        type: 'string',
        description: 'The name (or partial name) of the target project',
      },
      context_id: {
        type: 'string',
        description: 'The context entry ID (required for update and archive operations)',
      },
      summary_title: {
        type: 'string',
        description: 'A short descriptive title for the context entry (required for create, optional for update)',
      },
      summary_content: {
        type: 'string',
        description: 'A thorough, detailed summary. Include ALL key facts, decisions, numbers, action items, open questions, and takeaways. For updates, send the full updated content reflecting the current state. Required for create and update.',
      },
    },
    required: ['operation', 'project_name'],
  },
}

const SEARCH_GMAIL_TOOL: Anthropic.Messages.Tool = {
  name: 'search_gmail',
  description: `Search Jason's Gmail for emails matching a query. Uses the same search syntax as the Gmail search bar (from:, subject:, newer_than:, has:attachment, etc.). Use this when Jason asks you to find, look up, or reference emails. Build smart queries from natural language — try alternate terms or acronyms if the first search returns few results (e.g. try "LSM" if "local store marketing" returns nothing). You can call this tool multiple times to refine your search.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Gmail search query (same syntax as Gmail search bar)',
      },
      max_results: {
        type: 'number',
        description: 'Max emails to return (default 10)',
      },
    },
    required: ['query'],
  },
}

const MANAGE_PROJECT_TOOL: Anthropic.Messages.Tool = {
  name: 'manage_project',
  description: 'Create, update, or archive (delete) projects. Use fuzzy name matching for update/archive.',
  input_schema: {
    type: 'object' as const,
    properties: {
      operation: {
        type: 'string',
        enum: ['create', 'update', 'archive'],
        description: 'The operation to perform',
      },
      name: {
        type: 'string',
        description: 'Project name (required for create, used for fuzzy matching on update/archive)',
      },
      new_name: {
        type: 'string',
        description: 'New name for the project (update only, for renaming)',
      },
      description: {
        type: 'string',
        description: 'Project description',
      },
      color: {
        type: 'string',
        description: 'Hex color code (e.g. #3B82F6)',
      },
      system_prompt: {
        type: 'string',
        description: 'Custom system prompt for the project',
      },
    },
    required: ['operation', 'name'],
  },
}

const MANAGE_BOOKMARKS_TOOL: Anthropic.Messages.Tool = {
  name: 'manage_bookmarks',
  description: 'Create, list, or delete bookmarks on a project. Use fuzzy project name matching.',
  input_schema: {
    type: 'object' as const,
    properties: {
      operation: {
        type: 'string',
        enum: ['create', 'list', 'delete'],
        description: 'The operation to perform',
      },
      project_name: {
        type: 'string',
        description: 'Project name (fuzzy match)',
      },
      url: {
        type: 'string',
        description: 'URL for create operation',
      },
      title: {
        type: 'string',
        description: 'Title for the bookmark',
      },
      description: {
        type: 'string',
        description: 'Description for the bookmark',
      },
      bookmark_id: {
        type: 'string',
        description: 'Bookmark ID for delete operation',
      },
    },
    required: ['operation', 'project_name'],
  },
}

const MANAGE_DASHBOARD_TOOL: Anthropic.Messages.Tool = {
  name: 'manage_dashboard',
  description: 'Create, update, or remove dashboard summary cards. Cards appear on the main dashboard as pinned info boxes.',
  input_schema: {
    type: 'object' as const,
    properties: {
      operation: {
        type: 'string',
        enum: ['create', 'update', 'remove'],
        description: 'The operation to perform',
      },
      card_id: {
        type: 'string',
        description: 'Card ID for update/remove operations',
      },
      title: {
        type: 'string',
        description: 'Card title',
      },
      content: {
        type: 'string',
        description: 'Card content (markdown)',
      },
      card_type: {
        type: 'string',
        enum: ['summary', 'alert', 'custom'],
        description: 'Type of card (default: summary)',
      },
    },
    required: ['operation'],
  },
}

const MANAGE_NOTIFICATION_RULES_TOOL: Anthropic.Messages.Tool = {
  name: 'manage_notification_rules',
  description: 'Create, list, delete, or toggle notification rules. Rules define what emails trigger alerts.',
  input_schema: {
    type: 'object' as const,
    properties: {
      operation: {
        type: 'string',
        enum: ['create', 'list', 'delete', 'toggle'],
        description: 'The operation to perform',
      },
      rule_id: {
        type: 'string',
        description: 'Rule ID for delete/toggle operations',
      },
      description: {
        type: 'string',
        description: 'Human-readable description of the rule',
      },
      match_type: {
        type: 'string',
        enum: ['sender', 'subject', 'keyword'],
        description: 'What to match against',
      },
      match_value: {
        type: 'string',
        description: 'The value to match (email address, subject text, keyword)',
      },
      match_field: {
        type: 'string',
        description: 'Which field to search (default: any)',
      },
    },
    required: ['operation'],
  },
}

const MANAGE_PREFERENCES_TOOL: Anthropic.Messages.Tool = {
  name: 'manage_preferences',
  description: 'Set, get, or list UI preferences. Supported keys: sidebar_collapsed, accent_color.',
  input_schema: {
    type: 'object' as const,
    properties: {
      operation: {
        type: 'string',
        enum: ['set', 'get', 'list'],
        description: 'The operation to perform',
      },
      key: {
        type: 'string',
        description: 'Preference key (required for set/get)',
      },
      value: {
        type: 'string',
        description: 'Preference value (required for set)',
      },
    },
    required: ['operation'],
  },
}

const DRAFT_EMAIL_TOOL: Anthropic.Messages.Tool = {
  name: 'draft_email',
  description: 'Create a Gmail draft email. The draft will appear in Jason\'s Gmail drafts folder for review before sending. Use this to help delegate tasks, follow up with contacts, or compose messages Jason asks for.',
  input_schema: {
    type: 'object' as const,
    properties: {
      to: {
        type: 'string',
        description: 'Recipient email address(es), comma-separated for multiple',
      },
      subject: {
        type: 'string',
        description: 'Email subject line',
      },
      body: {
        type: 'string',
        description: 'Email body text (plain text)',
      },
      cc: {
        type: 'string',
        description: 'CC email address(es), comma-separated',
      },
    },
    required: ['to', 'subject', 'body'],
  },
}

const TRAINING_TOOL: Anthropic.Messages.Tool = {
  name: 'manage_training',
  description: 'Manage action item training. Use "teach_me" to start a quiz session with real email snippets. Use "label" to record feedback when Jason says something is or isn\'t an action item. Use "stats" to check training progress.',
  input_schema: {
    type: 'object' as const,
    properties: {
      operation: {
        type: 'string',
        enum: ['teach_me', 'label', 'stats'],
        description: 'The operation to perform',
      },
      snippet: { type: 'string', description: 'The text being labeled (for label operation)' },
      is_action_item: { type: 'boolean', description: 'Whether snippet is an action item (for label operation)' },
      source_type: { type: 'string', enum: ['email', 'chat'], description: 'Source type for label operation' },
      action_item_id: { type: 'string', description: 'Related action item ID if labeling from a dismiss/feedback' },
    },
    required: ['operation'],
  },
}

export async function POST(req: NextRequest) {
  const { message, conversation_id, project_id, active_artifact_id } = await req.json()

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

  // Save user message
  await supabaseAdmin.from('messages').insert({
    conversation_id: convId,
    role: 'user',
    content: message,
  })

  // Load conversation history (last 20 messages)
  const { data: history } = await supabaseAdmin
    .from('messages')
    .select('role, content')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: true })
    .limit(20)

  // Generate query embedding once and reuse for all vector searches
  const queryEmbedding = await generateQueryEmbedding(message).catch(e => { console.error('Query embedding failed:', e.message); return undefined })

  // RAG retrieval + action items + artifacts + all projects + training context in parallel
  const [chunks, pinnedDocs, memories, actionItemsResult, projectResult, contextChunks, artifactsResult, allProjectsResult, dashboardCardsResult, notificationRulesResult, uiPreferencesResult, trainingContext] = await Promise.all([
    retrieveRelevantChunks(message, project_id, 8, 0.7, queryEmbedding).catch(e => { console.error('RAG retrieval failed:', e.message); return [] }),
    project_id ? getPinnedDocuments(project_id) : Promise.resolve([]),
    getRelevantMemories(message),
    supabaseAdmin
      .from('action_items')
      .select('*')
      .in('status', ['pending', 'approved'])
      .order('created_at', { ascending: false })
      .limit(30),
    project_id
      ? supabaseAdmin.from('projects').select('system_prompt').eq('id', project_id).single()
      : Promise.resolve({ data: null }),
    retrieveRelevantContextChunks(message, project_id, 5, 0.7, queryEmbedding).catch(e => { console.error('Context retrieval failed:', e.message); return [] }),
    convId
      ? supabaseAdmin.from('artifacts').select('*').eq('conversation_id', convId).order('updated_at', { ascending: false })
      : Promise.resolve({ data: [] }),
    supabaseAdmin.from('projects').select('id, name, description').order('name'),
    supabaseAdmin.from('dashboard_cards').select('*').eq('is_active', true).order('position'),
    supabaseAdmin.from('notification_rules').select('*').eq('is_active', true).order('created_at', { ascending: false }),
    supabaseAdmin.from('ui_preferences').select('*'),
    buildFewShotBlock(message, queryEmbedding).catch(e => { console.error('Training context failed:', e.message); return null }),
  ])

  const actionItems: ActionItem[] = actionItemsResult.data || []
  const artifacts: Artifact[] = artifactsResult.data || []
  const projectPrompt = projectResult.data?.system_prompt || ''
  const allProjects: { id: string; name: string; description: string | null }[] = allProjectsResult.data || []
  const dashboardCards: DashboardCard[] = dashboardCardsResult.data || []
  const notificationRules: NotificationRule[] = notificationRulesResult.data || []
  const uiPreferences: UIPreference[] = uiPreferencesResult.data || []

  // Build context
  const context = buildContext(chunks, pinnedDocs, memories, contextChunks)
  const systemPrompt = buildSystemPrompt({
    projectSystemPrompt: projectPrompt,
    memories,
    documentContext: context,
    actionItems,
    artifacts,
    activeArtifactId: active_artifact_id,
    projects: allProjects,
    currentProjectId: project_id,
    dashboardCards,
    notificationRules,
    uiPreferences,
    trainingContext,
  })

  // Build messages array for Claude
  const chatMessages: Anthropic.Messages.MessageParam[] = (history || []).map((m: any) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))

  // Stream response with tool use loop
  const encoder = new TextEncoder()
  let fullResponse = ''

  const stream = new ReadableStream({
    async start(controller) {
      try {
        let currentMessages = [...chatMessages]
        let continueLoop = true

        while (continueLoop) {
          continueLoop = false

          const response = anthropic.messages.stream({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 4096,
            system: systemPrompt,
            messages: currentMessages,
            tools: [ACTION_ITEM_TOOL, MANAGE_PROJECT_CONTEXT_TOOL, ARTIFACT_TOOL, SEARCH_GMAIL_TOOL, DRAFT_EMAIL_TOOL, MANAGE_PROJECT_TOOL, MANAGE_BOOKMARKS_TOOL, MANAGE_DASHBOARD_TOOL, MANAGE_NOTIFICATION_RULES_TOOL, MANAGE_PREFERENCES_TOOL, TRAINING_TOOL],
          })

          // Collect content blocks for this turn
          const contentBlocks: Anthropic.Messages.ContentBlock[] = []
          let currentTextBlock = ''
          let currentToolUse: { id: string; name: string; inputJson: string } | null = null

          for await (const event of response) {
            if (event.type === 'content_block_start') {
              if (event.content_block.type === 'text') {
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
                const toolInput = JSON.parse(currentToolUse.inputJson || '{}')
                contentBlocks.push({
                  type: 'tool_use',
                  id: currentToolUse.id,
                  name: currentToolUse.name,
                  input: toolInput,
                } as Anthropic.Messages.ContentBlock)

                // Execute the tool
                let toolResult: any
                if (currentToolUse.name === 'manage_artifact') {
                  toolResult = await executeArtifactTool(toolInput, convId)
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    artifact: {
                      operation: toolInput.operation,
                      artifact: toolResult.artifact,
                    },
                  })}\n\n`))
                } else if (currentToolUse.name === 'manage_project_context') {
                  toolResult = await executeManageProjectContext(toolInput)
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    project_context: toolResult,
                  })}\n\n`))
                } else if (currentToolUse.name === 'search_gmail') {
                  try {
                    const emails = await searchEmails(toolInput.query, toolInput.max_results || 10)
                    toolResult = { status: 'ok', result_count: emails.length, emails }
                  } catch (e: any) {
                    toolResult = { status: 'error', message: e.message }
                  }
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    gmail_search: { query: toolInput.query, result_count: toolResult.result_count || 0 },
                  })}\n\n`))
                } else if (currentToolUse.name === 'draft_email') {
                  try {
                    const result = await createDraft(toolInput.to, toolInput.subject, toolInput.body, toolInput.cc)
                    toolResult = { status: 'drafted', draft_id: result.id, message: result.message }
                  } catch (e: any) {
                    toolResult = { status: 'error', message: e.message }
                  }
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    email_draft: {
                      to: toolInput.to,
                      subject: toolInput.subject,
                      status: toolResult.status,
                      message: toolResult.message,
                    },
                  })}\n\n`))
                } else if (currentToolUse.name === 'manage_project') {
                  toolResult = await executeProjectTool(toolInput)
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    project: {
                      operation: toolInput.operation,
                      project: toolResult.project,
                      status: toolResult.status,
                      message: toolResult.message,
                    },
                  })}\n\n`))
                } else if (currentToolUse.name === 'manage_bookmarks') {
                  toolResult = await executeBookmarkTool(toolInput)
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    bookmark: {
                      operation: toolInput.operation,
                      bookmark: toolResult.bookmark,
                      bookmarks: toolResult.bookmarks,
                      status: toolResult.status,
                      message: toolResult.message,
                    },
                  })}\n\n`))
                } else if (currentToolUse.name === 'manage_dashboard') {
                  toolResult = await executeDashboardCardTool(toolInput)
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    dashboard_card: {
                      operation: toolInput.operation,
                      card: toolResult.card,
                      status: toolResult.status,
                      message: toolResult.message,
                    },
                  })}\n\n`))
                } else if (currentToolUse.name === 'manage_notification_rules') {
                  toolResult = await executeNotificationRuleTool(toolInput)
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    notification_rule: {
                      operation: toolInput.operation,
                      rule: toolResult.rule,
                      rules: toolResult.rules,
                      status: toolResult.status,
                      message: toolResult.message,
                    },
                  })}\n\n`))
                } else if (currentToolUse.name === 'manage_preferences') {
                  toolResult = await executePreferencesTool(toolInput)
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    preference: {
                      key: toolInput.key,
                      value: toolResult.value,
                      status: toolResult.status,
                    },
                  })}\n\n`))
                } else if (currentToolUse.name === 'manage_training') {
                  toolResult = await executeTrainingTool(toolInput)
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    training: {
                      operation: toolInput.operation,
                      result: toolResult,
                    },
                  })}\n\n`))
                } else {
                  toolResult = await executeActionItemTool(toolInput, convId, actionItems)
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    action_item: {
                      operation: toolInput.operation,
                      result: toolResult,
                    }
                  })}\n\n`))
                }

                // Build messages for next turn
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

                currentToolUse = null
                continueLoop = true
              } else if (currentTextBlock) {
                contentBlocks.push({
                  type: 'text',
                  text: currentTextBlock,
                  citations: [],
                })
                currentTextBlock = ''
              }
            }
          }
        }

        // Save assistant message
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
        })

        // Update conversation timestamp
        await supabaseAdmin
          .from('conversations')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', convId)

        // Run memory extraction (action item extraction removed - handled by tool use)
        await extractMemories(convId, message, fullResponse)

        // Send done event with conversation_id
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, conversation_id: convId, sources })}\n\n`))
        controller.close()
      } catch (error) {
        console.error('Chat error:', error)
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Failed to generate response' })}\n\n`))
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

async function executeActionItemTool(
  input: { operation: string; title?: string; description?: string; priority?: string; due_date?: string; item_id?: string },
  conversationId: string,
  existingItems: ActionItem[],
): Promise<{ status: string; item?: ActionItem; items?: ActionItem[]; message?: string }> {
  switch (input.operation) {
    case 'create': {
      if (!input.title) return { status: 'error', message: 'Title is required' }

      // Dedup check: keyword match against existing items
      const titleWords = input.title.toLowerCase().split(/\s+/).filter(w => w.length > 3)
      const duplicate = existingItems.find(item => {
        const existingWords = item.title.toLowerCase().split(/\s+/)
        const matches = titleWords.filter(w => existingWords.some(ew => ew.includes(w) || w.includes(ew)))
        return matches.length >= Math.min(2, titleWords.length)
      })

      if (duplicate) {
        return {
          status: 'duplicate',
          item: duplicate,
          message: `Similar item already exists: "${duplicate.title}" (${duplicate.status}). Consider updating it instead.`,
        }
      }

      const { data, error } = await supabaseAdmin
        .from('action_items')
        .insert({
          title: input.title,
          description: input.description || null,
          source: 'chat',
          source_id: conversationId,
          status: 'approved',
          priority: input.priority || 'medium',
          due_date: input.due_date || null,
        })
        .select()
        .single()

      if (error) return { status: 'error', message: error.message }

      // Implicit training: record positive example if item has description context
      if (input.description && input.description.length > 20) {
        storeTrainingExample(input.description, true, 'implicit', 'chat', undefined, data.id)
          .catch(e => console.error('Implicit training (create) failed:', e))
      }

      // Push notification for new action items
      sendPushToAll('New Action Item', input.title, '/dashboard')
        .catch(e => console.error('Push notification failed:', e))

      return { status: 'created', item: data }
    }

    case 'complete': {
      if (!input.item_id) return { status: 'error', message: 'item_id is required' }

      const { data, error } = await supabaseAdmin
        .from('action_items')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', input.item_id)
        .select()
        .single()

      if (error) return { status: 'error', message: error.message }
      return { status: 'completed', item: data }
    }

    case 'update': {
      if (!input.item_id) return { status: 'error', message: 'item_id is required' }

      const updates: Record<string, any> = { updated_at: new Date().toISOString() }
      if (input.title) updates.title = input.title
      if (input.description !== undefined) updates.description = input.description
      if (input.priority) updates.priority = input.priority
      if (input.due_date) updates.due_date = input.due_date

      const { data, error } = await supabaseAdmin
        .from('action_items')
        .update(updates)
        .eq('id', input.item_id)
        .select()
        .single()

      if (error) return { status: 'error', message: error.message }
      return { status: 'updated', item: data }
    }

    case 'dismiss': {
      if (!input.item_id) return { status: 'error', message: 'item_id is required' }

      const { data, error } = await supabaseAdmin
        .from('action_items')
        .update({ status: 'dismissed', updated_at: new Date().toISOString() })
        .eq('id', input.item_id)
        .select()
        .single()

      if (error) return { status: 'error', message: error.message }

      // Implicit training: record negative example if item has a source snippet
      if (data.source_snippet) {
        storeTrainingExample(data.source_snippet, false, 'implicit', data.source || undefined, undefined, data.id)
          .catch(e => console.error('Implicit training (dismiss) failed:', e))
      }

      return { status: 'dismissed', item: data }
    }

    case 'snooze': {
      if (!input.item_id) return { status: 'error', message: 'item_id is required' }

      const snoozeUntil = input.due_date
        ? new Date(input.due_date).toISOString()
        : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()

      const { data, error } = await supabaseAdmin
        .from('action_items')
        .update({ snoozed_until: snoozeUntil, updated_at: new Date().toISOString() })
        .eq('id', input.item_id)
        .select()
        .single()

      if (error) return { status: 'error', message: error.message }
      return { status: 'snoozed', item: data, message: `Snoozed until ${new Date(snoozeUntil).toLocaleDateString()}` }
    }

    case 'list': {
      const { data } = await supabaseAdmin
        .from('action_items')
        .select('*')
        .in('status', ['pending', 'approved'])
        .or('snoozed_until.is.null,snoozed_until.lte.' + new Date().toISOString())
        .order('priority', { ascending: true })
        .order('created_at', { ascending: false })
        .limit(30)

      return { status: 'ok', items: data || [] }
    }

    default:
      return { status: 'error', message: `Unknown operation: ${input.operation}` }
  }
}

async function executeArtifactTool(
  input: { operation: string; artifact_id?: string; name?: string; content?: string; type?: string },
  conversationId: string,
): Promise<{ status: string; artifact?: Artifact; message?: string }> {
  if (input.operation === 'create') {
    if (!input.name || !input.content) return { status: 'error', message: 'Name and content are required' }

    const { data, error } = await supabaseAdmin
      .from('artifacts')
      .insert({
        name: input.name,
        content: input.content,
        type: input.type || 'freeform',
        conversation_id: conversationId,
        version: 1,
      })
      .select()
      .single()

    if (error) return { status: 'error', message: error.message }

    // Insert version 1
    await supabaseAdmin.from('artifact_versions').insert({
      artifact_id: data.id,
      content: input.content,
      version: 1,
      change_summary: 'Initial version',
      changed_by: 'assistant',
    })

    return { status: 'created', artifact: data }
  }

  if (input.operation === 'update') {
    if (!input.artifact_id) return { status: 'error', message: 'artifact_id is required for update' }
    if (!input.content) return { status: 'error', message: 'content is required for update' }

    // Get current to snapshot
    const { data: current } = await supabaseAdmin.from('artifacts').select('*').eq('id', input.artifact_id).single()
    if (!current) return { status: 'error', message: 'Artifact not found' }

    // Snapshot old version
    await supabaseAdmin.from('artifact_versions').insert({
      artifact_id: input.artifact_id,
      content: current.content,
      version: current.version,
      change_summary: null,
      changed_by: 'assistant',
    })

    const updates: Record<string, any> = {
      content: input.content,
      version: current.version + 1,
      updated_at: new Date().toISOString(),
    }
    if (input.name) updates.name = input.name
    if (input.type) updates.type = input.type

    const { data, error } = await supabaseAdmin
      .from('artifacts')
      .update(updates)
      .eq('id', input.artifact_id)
      .select()
      .single()

    if (error) return { status: 'error', message: error.message }
    return { status: 'updated', artifact: data }
  }

  return { status: 'error', message: `Unknown operation: ${input.operation}` }
}

async function executeManageProjectContext(
  input: { operation: string; project_name: string; context_id?: string; summary_title?: string; summary_content?: string },
): Promise<{ status: string; project_name?: string; project_id?: string; context_id?: string; message?: string }> {
  // Find project by fuzzy name match
  const { data: projects } = await supabaseAdmin
    .from('projects')
    .select('id, name')
    .ilike('name', `%${input.project_name}%`)
    .limit(5)

  if (!projects || projects.length === 0) {
    return { status: 'error', message: `No project found matching "${input.project_name}"` }
  }
  const project = projects[0]

  switch (input.operation) {
    case 'create': {
      if (!input.summary_title || !input.summary_content) {
        return { status: 'error', message: 'summary_title and summary_content are required for create' }
      }

      const { data: ctx, error } = await supabaseAdmin
        .from('project_context')
        .insert({
          project_id: project.id,
          title: input.summary_title,
          content: input.summary_content,
        })
        .select()
        .single()

      if (error) return { status: 'error', message: error.message }

      // Background: chunk and embed
      chunkAndEmbedContext(ctx.id, input.summary_content).catch(console.error)

      return { status: 'created', project_name: project.name, project_id: project.id, context_id: ctx.id }
    }

    case 'update': {
      if (!input.context_id) return { status: 'error', message: 'context_id is required for update' }
      if (!input.summary_content) return { status: 'error', message: 'summary_content is required for update' }

      const update: Record<string, any> = {
        content: input.summary_content,
        updated_at: new Date().toISOString(),
      }
      if (input.summary_title) update.title = input.summary_title

      const { data: ctx, error } = await supabaseAdmin
        .from('project_context')
        .update(update)
        .eq('id', input.context_id)
        .select()
        .single()

      if (error) return { status: 'error', message: error.message }

      // Re-chunk and re-embed with updated content
      chunkAndEmbedContext(ctx.id, ctx.content).catch(console.error)

      return { status: 'updated', project_name: project.name, project_id: project.id, context_id: ctx.id }
    }

    case 'archive': {
      if (!input.context_id) return { status: 'error', message: 'context_id is required for archive' }

      // Delete the context entry and its chunks (cascade handles chunks)
      const { error } = await supabaseAdmin
        .from('project_context')
        .delete()
        .eq('id', input.context_id)

      if (error) return { status: 'error', message: error.message }

      return { status: 'archived', project_name: project.name, project_id: project.id, context_id: input.context_id }
    }

    default:
      return { status: 'error', message: `Unknown operation: ${input.operation}` }
  }
}

async function executeProjectTool(
  input: { operation: string; name: string; new_name?: string; description?: string; color?: string; system_prompt?: string },
): Promise<{ status: string; project?: any; message?: string }> {
  switch (input.operation) {
    case 'create': {
      const { data, error } = await supabaseAdmin
        .from('projects')
        .insert({
          name: input.name,
          description: input.description || null,
          color: input.color || '#3B82F6',
          system_prompt: input.system_prompt || null,
        })
        .select()
        .single()

      if (error) return { status: 'error', message: error.message }
      return { status: 'created', project: data }
    }

    case 'update': {
      const { data: projects } = await supabaseAdmin
        .from('projects')
        .select('*')
        .ilike('name', `%${input.name}%`)
        .limit(5)

      if (!projects || projects.length === 0) {
        return { status: 'error', message: `No project found matching "${input.name}"` }
      }
      const project = projects[0]

      const updates: Record<string, any> = { updated_at: new Date().toISOString() }
      if (input.new_name) updates.name = input.new_name
      if (input.description !== undefined) updates.description = input.description
      if (input.color) updates.color = input.color
      if (input.system_prompt !== undefined) updates.system_prompt = input.system_prompt

      const { data, error } = await supabaseAdmin
        .from('projects')
        .update(updates)
        .eq('id', project.id)
        .select()
        .single()

      if (error) return { status: 'error', message: error.message }
      return { status: 'updated', project: data }
    }

    case 'archive': {
      const { data: projects } = await supabaseAdmin
        .from('projects')
        .select('id, name')
        .ilike('name', `%${input.name}%`)
        .limit(5)

      if (!projects || projects.length === 0) {
        return { status: 'error', message: `No project found matching "${input.name}"` }
      }
      const project = projects[0]

      const { error } = await supabaseAdmin
        .from('projects')
        .delete()
        .eq('id', project.id)

      if (error) return { status: 'error', message: error.message }
      return { status: 'archived', project: { id: project.id, name: project.name } }
    }

    default:
      return { status: 'error', message: `Unknown operation: ${input.operation}` }
  }
}

async function executeBookmarkTool(
  input: { operation: string; project_name: string; url?: string; title?: string; description?: string; bookmark_id?: string },
): Promise<{ status: string; bookmark?: Bookmark; bookmarks?: Bookmark[]; message?: string }> {
  // Find project by fuzzy name
  const { data: projects } = await supabaseAdmin
    .from('projects')
    .select('id, name')
    .ilike('name', `%${input.project_name}%`)
    .limit(5)

  if (!projects || projects.length === 0) {
    return { status: 'error', message: `No project found matching "${input.project_name}"` }
  }
  const project = projects[0]

  switch (input.operation) {
    case 'create': {
      if (!input.url || !input.title) return { status: 'error', message: 'url and title are required' }

      const { data, error } = await supabaseAdmin
        .from('bookmarks')
        .insert({
          project_id: project.id,
          url: input.url,
          title: input.title,
          description: input.description || null,
        })
        .select()
        .single()

      if (error) return { status: 'error', message: error.message }
      return { status: 'created', bookmark: data }
    }

    case 'list': {
      const { data } = await supabaseAdmin
        .from('bookmarks')
        .select('*')
        .eq('project_id', project.id)
        .order('created_at', { ascending: false })

      return { status: 'ok', bookmarks: data || [] }
    }

    case 'delete': {
      if (!input.bookmark_id) return { status: 'error', message: 'bookmark_id is required' }

      const { error } = await supabaseAdmin
        .from('bookmarks')
        .delete()
        .eq('id', input.bookmark_id)

      if (error) return { status: 'error', message: error.message }
      return { status: 'deleted' }
    }

    default:
      return { status: 'error', message: `Unknown operation: ${input.operation}` }
  }
}

async function executeDashboardCardTool(
  input: { operation: string; card_id?: string; title?: string; content?: string; card_type?: string },
): Promise<{ status: string; card?: DashboardCard; message?: string }> {
  switch (input.operation) {
    case 'create': {
      if (!input.title || !input.content) return { status: 'error', message: 'title and content are required' }

      // Get next position
      const { data: existing } = await supabaseAdmin
        .from('dashboard_cards')
        .select('position')
        .eq('is_active', true)
        .order('position', { ascending: false })
        .limit(1)

      const nextPos = existing && existing.length > 0 ? existing[0].position + 1 : 0

      const { data, error } = await supabaseAdmin
        .from('dashboard_cards')
        .insert({
          title: input.title,
          content: input.content,
          card_type: input.card_type || 'summary',
          position: nextPos,
        })
        .select()
        .single()

      if (error) return { status: 'error', message: error.message }
      return { status: 'created', card: data }
    }

    case 'update': {
      if (!input.card_id) return { status: 'error', message: 'card_id is required' }

      const updates: Record<string, any> = { updated_at: new Date().toISOString() }
      if (input.title) updates.title = input.title
      if (input.content) updates.content = input.content
      if (input.card_type) updates.card_type = input.card_type

      const { data, error } = await supabaseAdmin
        .from('dashboard_cards')
        .update(updates)
        .eq('id', input.card_id)
        .select()
        .single()

      if (error) return { status: 'error', message: error.message }
      return { status: 'updated', card: data }
    }

    case 'remove': {
      if (!input.card_id) return { status: 'error', message: 'card_id is required' }

      const { error } = await supabaseAdmin
        .from('dashboard_cards')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', input.card_id)

      if (error) return { status: 'error', message: error.message }
      return { status: 'removed' }
    }

    default:
      return { status: 'error', message: `Unknown operation: ${input.operation}` }
  }
}

async function executeNotificationRuleTool(
  input: { operation: string; rule_id?: string; description?: string; match_type?: string; match_value?: string; match_field?: string },
): Promise<{ status: string; rule?: NotificationRule; rules?: NotificationRule[]; message?: string }> {
  switch (input.operation) {
    case 'create': {
      if (!input.description || !input.match_type || !input.match_value) {
        return { status: 'error', message: 'description, match_type, and match_value are required' }
      }

      const { data, error } = await supabaseAdmin
        .from('notification_rules')
        .insert({
          description: input.description,
          match_type: input.match_type,
          match_value: input.match_value,
          match_field: input.match_field || 'any',
        })
        .select()
        .single()

      if (error) return { status: 'error', message: error.message }
      return { status: 'created', rule: data }
    }

    case 'list': {
      const { data } = await supabaseAdmin
        .from('notification_rules')
        .select('*')
        .order('created_at', { ascending: false })

      return { status: 'ok', rules: data || [] }
    }

    case 'delete': {
      if (!input.rule_id) return { status: 'error', message: 'rule_id is required' }

      const { error } = await supabaseAdmin
        .from('notification_rules')
        .delete()
        .eq('id', input.rule_id)

      if (error) return { status: 'error', message: error.message }
      return { status: 'deleted' }
    }

    case 'toggle': {
      if (!input.rule_id) return { status: 'error', message: 'rule_id is required' }

      const { data: current } = await supabaseAdmin
        .from('notification_rules')
        .select('is_active')
        .eq('id', input.rule_id)
        .single()

      if (!current) return { status: 'error', message: 'Rule not found' }

      const { data, error } = await supabaseAdmin
        .from('notification_rules')
        .update({ is_active: !current.is_active })
        .eq('id', input.rule_id)
        .select()
        .single()

      if (error) return { status: 'error', message: error.message }
      return { status: data.is_active ? 'enabled' : 'disabled', rule: data }
    }

    default:
      return { status: 'error', message: `Unknown operation: ${input.operation}` }
  }
}

async function executePreferencesTool(
  input: { operation: string; key?: string; value?: string },
): Promise<{ status: string; value?: string; preferences?: UIPreference[]; message?: string }> {
  const validKeys = ['sidebar_collapsed', 'accent_color']

  switch (input.operation) {
    case 'set': {
      if (!input.key || input.value === undefined) return { status: 'error', message: 'key and value are required' }
      if (!validKeys.includes(input.key)) return { status: 'error', message: `Invalid key. Valid keys: ${validKeys.join(', ')}` }

      const { data, error } = await supabaseAdmin
        .from('ui_preferences')
        .upsert(
          { key: input.key, value: input.value, updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        )
        .select()
        .single()

      if (error) return { status: 'error', message: error.message }
      return { status: 'set', value: data.value }
    }

    case 'get': {
      if (!input.key) return { status: 'error', message: 'key is required' }

      const { data } = await supabaseAdmin
        .from('ui_preferences')
        .select('*')
        .eq('key', input.key)
        .single()

      if (!data) return { status: 'not_set', message: `No preference set for "${input.key}"` }
      return { status: 'ok', value: data.value }
    }

    case 'list': {
      const { data } = await supabaseAdmin
        .from('ui_preferences')
        .select('*')
        .order('key')

      return { status: 'ok', preferences: data || [] }
    }

    default:
      return { status: 'error', message: `Unknown operation: ${input.operation}` }
  }
}

async function executeTrainingTool(
  input: { operation: string; snippet?: string; is_action_item?: boolean; source_type?: string; action_item_id?: string },
): Promise<any> {
  switch (input.operation) {
    case 'teach_me': {
      try {
        // Reuse the teach-me logic: fetch recent emails and build snippets
        const { data: tokenRow } = await supabaseAdmin
          .from('gmail_tokens')
          .select('account')
          .limit(1)
          .single()

        if (!tokenRow) {
          return { status: 'no_gmail', message: 'No Gmail account connected', snippets: [] }
        }

        const since = new Date(Date.now() - 3 * 24 * 3600000)
        const emails = await fetchEmails(tokenRow.account, since)

        if (emails.length === 0) {
          return { status: 'no_emails', message: 'No recent emails found', snippets: [] }
        }

        const { data: existingItems } = await supabaseAdmin
          .from('action_items')
          .select('source_id')
          .eq('source', 'email')
          .not('source_id', 'is', null)

        const flaggedEmailIds = new Set((existingItems || []).map((i: any) => i.source_id))

        const snippets = emails.slice(0, 20).map(email => ({
          text: `From: ${email.from}\nSubject: ${email.subject}\n\n${email.body.slice(0, 500)}`,
          source_type: 'email' as const,
          has_action_item: flaggedEmailIds.has(email.id),
          metadata: { email_id: email.id, subject: email.subject, from: email.from },
        }))

        const shuffled = snippets.sort(() => Math.random() - 0.5).slice(0, 10)
        return { status: 'ok', snippets: shuffled }
      } catch (e: any) {
        return { status: 'error', message: e.message || 'Failed to load snippets', snippets: [] }
      }
    }

    case 'label': {
      if (!input.snippet || input.is_action_item === undefined) {
        return { status: 'error', message: 'snippet and is_action_item are required' }
      }

      try {
        const result = await storeTrainingExample(
          input.snippet,
          input.is_action_item,
          'feedback',
          (input.source_type as 'email' | 'chat') || undefined,
          undefined,
          input.action_item_id,
        )
        return { status: 'labeled', id: result.id, is_action_item: input.is_action_item }
      } catch (e: any) {
        return { status: 'error', message: e.message }
      }
    }

    case 'stats': {
      try {
        const stats = await getTrainingStats()
        return { status: 'ok', ...stats }
      } catch (e: any) {
        return { status: 'error', message: e.message }
      }
    }

    default:
      return { status: 'error', message: `Unknown operation: ${input.operation}` }
  }
}

function parseJSON(text: string) {
  let cleaned = text.trim()
  // Strip markdown code fences
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }
  // Try to extract JSON object if there's surrounding text
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (match) {
    return JSON.parse(match[0])
  }
  return JSON.parse(cleaned)
}

// Background: Extract memories
async function extractMemories(conversationId: string, userMessage: string, assistantResponse: string) {
  try {
    // Load existing memories so Claude can avoid duplicates
    const { data: existingMemories } = await supabaseAdmin
      .from('memories')
      .select('id, content, category')
      .order('created_at', { ascending: false })
      .limit(50)

    const existingList = (existingMemories || [])
      .map((m: any) => `- [${m.category}] (id: ${m.id}) ${m.content}`)
      .join('\n')

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: `You manage a memory system for Jason DeMayo (also goes by "Jerry"). Extract genuinely NEW information from this conversation turn.

Rules:
- Each memory: ONE concise sentence, max two. No paragraphs.
- Skip anything already covered by existing memories below.
- Skip generic/obvious info. Only store specifics about Jason's business, preferences, contacts, or ongoing situations.
- If new info updates an existing memory, use "update" with that memory's id.
- If completely new, use "create".
- If nothing new worth storing, return empty arrays.
- Jason = Jerry = Jason DeMayo. Never store this alias as a separate memory.

PREFERENCE DETECTION — pay special attention to statements about alerts, notifications, briefings, and what Jason cares about. These should be stored with category "preference". Examples:
- "Stop alerting me about X" → preference: "Do not alert about X"
- "Always tell me when Y" → preference: "Always alert when Y happens"
- "I don't care about Z" → preference: "Exclude Z from briefings and alerts"
- "Morning briefings should focus on..." → preference about briefing content
- "Only alert for high-priority items" → preference about alert threshold
- "Include/exclude [store/topic] in briefings" → preference about briefing scope
Any time Jason expresses what he wants to see more or less of, that's a preference.

EXISTING MEMORIES:
${existingList || '(none)'}

Return raw JSON only:
{"create": [{"content": "...", "category": "fact|preference|context"}], "update": [{"id": "uuid", "content": "updated text", "category": "fact|preference|context"}]}`,
      messages: [
        { role: 'user', content: `User said: ${userMessage}\n\nAssistant replied: ${assistantResponse}` },
      ],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    console.log('Memory extraction raw:', text.slice(0, 200))
    const parsed = parseJSON(text)

    // Handle creates
    if (parsed.create && parsed.create.length > 0) {
      for (const memory of parsed.create) {
        if (memory.content && memory.content.length > 5) {
          await supabaseAdmin.from('memories').insert({
            content: memory.content,
            category: memory.category || 'context',
            source_conversation_id: conversationId,
          })
        }
      }
      console.log(`Memory: created ${parsed.create.length} new`)
    }

    // Handle updates
    if (parsed.update && parsed.update.length > 0) {
      for (const memory of parsed.update) {
        if (memory.id && memory.content) {
          await supabaseAdmin.from('memories').update({
            content: memory.content,
            category: memory.category || 'context',
            updated_at: new Date().toISOString(),
          }).eq('id', memory.id)
        }
      }
      console.log(`Memory: updated ${parsed.update.length} existing`)
    }

    if ((!parsed.create || parsed.create.length === 0) && (!parsed.update || parsed.update.length === 0)) {
      console.log('Memory: nothing new to store')
    }
  } catch (e) {
    console.error('Memory extraction failed:', e)
  }
}
