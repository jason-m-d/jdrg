import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: Request) {
  const { user_id, endpoint, p256dh, auth } = await req.json()

  if (!user_id || !endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('push_subscriptions').upsert(
    { user_id, endpoint, p256dh, auth },
    { onConflict: 'user_id,endpoint' }
  )

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const { user_id, endpoint } = await req.json()

  if (!user_id || !endpoint) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  await supabaseAdmin
    .from('push_subscriptions')
    .delete()
    .eq('user_id', user_id)
    .eq('endpoint', endpoint)

  return NextResponse.json({ ok: true })
}
