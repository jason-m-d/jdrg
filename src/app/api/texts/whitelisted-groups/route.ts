import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

function authOk(req: NextRequest) {
  return req.headers.get('x-bridge-api-key') === process.env.BRIDGE_API_KEY
}

export async function GET(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('text_group_whitelist')
    .select('chat_identifier')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ groups: (data ?? []).map(r => r.chat_identifier) })
}
