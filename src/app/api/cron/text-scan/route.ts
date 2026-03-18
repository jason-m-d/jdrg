import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { openrouterClient } from '@/lib/openrouter'

export const maxDuration = 60

const BACKGROUND_MODEL = 'google/gemini-3.1-flash-lite-preview'
const BACKGROUND_FALLBACK = 'google/gemini-3-flash-preview'
const BATCH_SIZE = 20

function jsonBody(schema: Record<string, unknown>) {
  return {
    model: BACKGROUND_MODEL,
    extra_body: {
      models: [BACKGROUND_MODEL, BACKGROUND_FALLBACK],
      provider: { sort: 'price' },
      plugins: [{ id: 'response-healing' }],
      response_format: { type: 'json_schema', json_schema: { name: 'response', strict: true, schema } },
    },
  }
}

const CLASSIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    classifications: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          chat_db_row_id: { type: 'number' },
          is_business: { type: 'boolean' },
          reason: { type: 'string' },
        },
        required: ['chat_db_row_id', 'is_business', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['classifications'],
  additionalProperties: false,
}

export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret') || req.headers.get('authorization')
  if (cronSecret !== process.env.CRON_SECRET && cronSecret !== 'manual' && cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Load known contacts for context
  const { data: contacts } = await supabaseAdmin
    .from('text_contacts')
    .select('contact_name, role, phone_number')
    .order('contact_name', { ascending: true })

  const contactContext = contacts && contacts.length > 0
    ? `Known contacts:\n${contacts.map(c => `- ${c.contact_name} (${c.role ?? 'unknown role'}): ${c.phone_number}`).join('\n')}`
    : 'No known contacts on file yet.'

  // Fetch unscanned inbound messages
  const { data: messages, error: fetchError } = await supabaseAdmin
    .from('text_messages')
    .select('id, chat_db_row_id, phone_number, contact_name, message_text, message_date, is_group_chat, group_chat_name, service')
    .eq('scanned', false)
    .eq('is_from_me', false)
    .order('message_date', { ascending: true })
    .limit(200) // cap per run, process in batches below

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  if (!messages || messages.length === 0) {
    return NextResponse.json({ processed: 0, flagged: 0 })
  }

  let totalProcessed = 0
  let totalFlagged = 0

  // Process in batches of BATCH_SIZE
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE)

    const messagesText = batch.map(m => {
      const sender = m.contact_name ?? m.phone_number
      const context = m.is_group_chat ? ` [group: ${m.group_chat_name ?? 'unknown'}]` : ''
      const date = new Date(m.message_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      return `ID: ${m.chat_db_row_id} | From: ${sender}${context} | ${date}\n"${m.message_text}"`
    }).join('\n\n')

    const systemPrompt = `You are classifying text messages for a restaurant group CEO who owns 8 Wingstop and 2 Mr. Pickle's sandwich locations across California and Texas.

${contactContext}

For each message, determine if it's business-relevant or not.

Business-relevant = from a manager, vendor, employee, landlord, supplier, delivery driver, health inspector, tech support, HR contact, or about store operations, staffing, scheduling, equipment, sales, deliveries, food costs, complaints, inspections, compliance, or any restaurant business topic.

Not business-relevant = personal conversations, family, friends, spam, marketing texts, promotional offers, casual social messages.

Return a classification for every message ID provided.`

    try {
      const { extra_body, ...modelParams } = jsonBody(CLASSIFICATION_SCHEMA)
      const completion = await openrouterClient.chat.completions.create(
        {
          ...modelParams,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Classify these ${batch.length} messages:\n\n${messagesText}` },
          ],
        },
        { body: extra_body } as Parameters<typeof openrouterClient.chat.completions.create>[1]
      )

      const raw = completion.choices[0]?.message?.content ?? '{}'
      const parsed = JSON.parse(raw) as { classifications: { chat_db_row_id: number; is_business: boolean; reason: string }[] }
      const classifications = parsed.classifications ?? []

      // Build lookup map
      const classMap = new Map(classifications.map(c => [c.chat_db_row_id, c]))

      // Update each message
      for (const msg of batch) {
        const cls = classMap.get(msg.chat_db_row_id)
        const isBusiness = cls?.is_business ?? false
        const reason = cls?.reason ?? null

        await supabaseAdmin
          .from('text_messages')
          .update({
            scanned: true,
            flagged: isBusiness,
            flag_reason: isBusiness ? reason : null,
          })
          .eq('id', msg.id)

        if (isBusiness) totalFlagged++
      }

      totalProcessed += batch.length
    } catch (err) {
      // Mark batch as scanned even on AI failure so we don't retry forever
      const ids = batch.map(m => m.id)
      await supabaseAdmin
        .from('text_messages')
        .update({ scanned: true })
        .in('id', ids)

      console.error('[text-scan] AI batch failed:', (err as Error).message?.slice(0, 200))
      totalProcessed += batch.length
    }
  }

  return NextResponse.json({ processed: totalProcessed, flagged: totalFlagged })
}

export async function GET(req: NextRequest) {
  return POST(req)
}
