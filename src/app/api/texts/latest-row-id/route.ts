import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

function authOk(req: NextRequest) {
  return req.headers.get('x-bridge-api-key') === process.env.BRIDGE_API_KEY
}

export async function GET(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('text_messages')
    .select('chat_db_row_id')
    .order('chat_db_row_id', { ascending: false })
    .limit(1)
    .single()

  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ latest_row_id: data?.chat_db_row_id ?? 0 })
}
