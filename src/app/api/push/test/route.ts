import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendPushNotification } from '@/lib/push'

export async function GET() {
  // Get the first user with a push subscription
  const { data: sub, error } = await supabaseAdmin
    .from('push_subscriptions')
    .select('user_id')
    .limit(1)
    .single()

  if (error || !sub) {
    return NextResponse.json({
      error: 'No push subscriptions found',
      detail: error?.message,
      hint: error?.hint,
    }, { status: 404 })
  }

  const results = await sendPushNotification(
    sub.user_id,
    'J.DRG Test',
    'Push notifications are working!',
    '/dashboard'
  )

  return NextResponse.json({ ok: true, sent_to: sub.user_id, results })
}
