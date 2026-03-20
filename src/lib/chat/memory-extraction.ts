import { supabaseAdmin } from '@/lib/supabase'
import { openrouterClient } from '@/lib/openrouter'

export function parseJSON(text: string) {
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

// In-process debounce: track when extraction last ran to avoid parallel duplicate runs.
let lastExtractionAt = 0
const EXTRACTION_DEBOUNCE_MS = 5000

export async function extractMemories(conversationId: string, userMessage: string, assistantResponse: string) {
  try {
    // Debounce: skip if another extraction ran in the last 5 seconds.
    // Prevents duplicate memories when two messages arrive in rapid succession.
    const now = Date.now()
    if (now - lastExtractionAt < EXTRACTION_DEBOUNCE_MS) {
      console.log('Memory: skipping extraction — ran < 5s ago')
      return
    }
    lastExtractionAt = now

    // Load existing memories so Claude can avoid duplicates
    const { data: existingMemories } = await supabaseAdmin
      .from('memories')
      .select('id, content, category')
      .order('created_at', { ascending: false })
      .limit(50)

    const existingList = (existingMemories || [])
      .map((m: any) => `- [${m.category}] (id: ${m.id}) ${m.content}`)
      .join('\n')

    const memorySchema = {
      type: 'object',
      properties: {
        create: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string' },
              category: { type: 'string', enum: ['fact', 'preference', 'context'] },
            },
            required: ['content', 'category'],
            additionalProperties: false,
          },
        },
        update: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              content: { type: 'string' },
              category: { type: 'string', enum: ['fact', 'preference', 'context'] },
            },
            required: ['id', 'content', 'category'],
            additionalProperties: false,
          },
        },
      },
      required: ['create', 'update'],
      additionalProperties: false,
    }

    const response = await openrouterClient.chat.completions.create({
      model: 'google/gemini-3.1-flash-lite-preview',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: `You manage a memory system for Jason DeMayo (also goes by "Jerry"). Extract genuinely NEW information from this conversation turn.

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
{"create": [{"content": "...", "category": "fact|preference|context"}], "update": [{"id": "uuid", "content": "updated text", "category": "fact|preference|context"}]}` },
        { role: 'user', content: `User said: ${userMessage}\n\nAssistant replied: ${assistantResponse}` },
      ],
      ...({
        models: ['google/gemini-3.1-flash-lite-preview', 'google/gemini-3-flash-preview'],
        provider: { sort: 'price' },
        plugins: [{ id: 'response-healing' }],
        response_format: { type: 'json_schema', json_schema: { name: 'response', strict: true, schema: memorySchema } },
      } as any),
    } as any)

    const text = response.choices[0]?.message?.content || ''
    console.log('Memory extraction raw:', text.slice(0, 200))
    let parsed: any
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = parseJSON(text)
    }

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
