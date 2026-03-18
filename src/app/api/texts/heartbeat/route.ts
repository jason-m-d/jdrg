import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

function authOk(req: NextRequest) {
  return req.headers.get('x-bridge-api-key') === process.env.BRIDGE_API_KEY
}

export async function POST(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { messages_synced?: number; error?: string | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { error: dbError } = await supabaseAdmin
    .from('bridge_heartbeats')
    .upsert(
      {
        bridge_name: 'imessage',
        last_heartbeat_at: new Date().toISOString(),
        status: 'healthy',
        messages_synced: body.messages_synced ?? 0,
        error: body.error ?? null,
      },
      { onConflict: 'bridge_name' }
    )

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })

  return NextResponse.json({ status: 'ok' })
}
