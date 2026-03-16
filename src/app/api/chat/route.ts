import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase'
import { retrieveRelevantChunks, getPinnedDocuments, getRelevantMemories, buildContext } from '@/lib/rag'
import { buildSystemPrompt } from '@/lib/system-prompt'
import type { ActionItem } from '@/lib/types'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const ACTION_ITEM_TOOL: Anthropic.Messages.Tool = {
  name: 'manage_action_items',
  description: 'Create, complete, update, or list action items for Jason. Use this to track important tasks, mark things done, or check what is outstanding.',
  input_schema: {
    type: 'object' as const,
    properties: {
      operation: {
        type: 'string',
        enum: ['create', 'complete', 'update', 'list'],
        description: 'The operation to perform',
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

export async function POST(req: NextRequest) {
  const { message, conversation_id, project_id } = await req.json()

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

  // RAG retrieval + action items in parallel
  const [chunks, pinnedDocs, memories, actionItemsResult, projectResult] = await Promise.all([
    retrieveRelevantChunks(message, project_id),
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
  ])

  const actionItems: ActionItem[] = actionItemsResult.data || []
  const projectPrompt = projectResult.data?.system_prompt || ''

  // Build context
  const context = buildContext(chunks, pinnedDocs, memories)
  const systemPrompt = buildSystemPrompt({
    projectSystemPrompt: projectPrompt,
    memories,
    documentContext: context,
    actionItems,
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
            tools: [ACTION_ITEM_TOOL],
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
                const toolResult = await executeActionItemTool(toolInput, convId, actionItems)

                // Send action_item event to frontend
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                  action_item: {
                    operation: toolInput.operation,
                    result: toolResult,
                  }
                })}\n\n`))

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

    case 'list': {
      const { data } = await supabaseAdmin
        .from('action_items')
        .select('*')
        .in('status', ['pending', 'approved'])
        .order('priority', { ascending: true })
        .order('created_at', { ascending: false })
        .limit(30)

      return { status: 'ok', items: data || [] }
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
