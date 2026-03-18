import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { normalizePhone } from '@/lib/phone'

function authOk(req: NextRequest) {
  return req.headers.get('x-bridge-api-key') === process.env.BRIDGE_API_KEY
}

interface IngestMessage {
  phone_number: string
  message_text: string
  is_from_me: boolean
  is_group_chat: boolean
  group_chat_name: string | null
  chat_identifier: string | null
  service: string
  chat_db_row_id: number
  message_date: string
}

export async function POST(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { messages: IngestMessage[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { messages } = body
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'messages array required' }, { status: 400 })
  }

  // Normalize phone numbers
  const normalized = messages.map(m => ({
    ...m,
    phone_number: normalizePhone(m.phone_number),
  }))

  // Resolve contact names from text_contacts
  const phones = [...new Set(normalized.map(m => m.phone_number).filter(Boolean))]
  const { data: contacts } = await supabaseAdmin
    .from('text_contacts')
    .select('phone_number, contact_name')
    .in('phone_number', phones)

  const contactMap = new Map((contacts ?? []).map(c => [c.phone_number, c.contact_name]))

  const rows = normalized.map(m => ({
    phone_number: m.phone_number,
    contact_name: contactMap.get(m.phone_number) ?? null,
    message_text: m.message_text,
    is_from_me: m.is_from_me,
    is_group_chat: m.is_group_chat,
    group_chat_name: m.group_chat_name ?? null,
    chat_identifier: m.chat_identifier ?? null,
    service: m.service,
    chat_db_row_id: m.chat_db_row_id,
    message_date: m.message_date,
  }))

  // ignoreDuplicates: true = ON CONFLICT DO NOTHING (idempotent re-runs)
  const { data: inserted, error } = await supabaseAdmin
    .from('text_messages')
    .upsert(rows, { onConflict: 'chat_db_row_id', ignoreDuplicates: true })
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ingested = inserted?.length ?? 0
  return NextResponse.json({ ingested, skipped: rows.length - ingested })
}
