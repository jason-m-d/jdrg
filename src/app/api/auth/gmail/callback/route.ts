import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  if (!code) return NextResponse.redirect('/settings/email?error=no_code')

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/auth/gmail/callback`

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GMAIL_CLIENT_ID!,
      client_secret: process.env.GMAIL_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  const tokens = await tokenRes.json()
  if (!tokens.refresh_token) {
    return NextResponse.redirect('/settings/email?error=no_refresh_token')
  }

  // Get user email
  const profileRes = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const profile = await profileRes.json()
  const account = profile.emailAddress

  // Upsert token
  await supabaseAdmin.from('gmail_tokens').upsert({
    account,
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
  }, { onConflict: 'account' })

  // Also store calendar tokens (same credentials, calendar scope was requested alongside Gmail)
  await supabaseAdmin.from('calendar_tokens').upsert({
    account,
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
  }, { onConflict: 'account' })

  // Create calendar_syncs entry if not exists
  const { data: existingSync } = await supabaseAdmin.from('calendar_syncs').select('id').eq('account', account).single()
  if (!existingSync) {
    await supabaseAdmin.from('calendar_syncs').insert({
      account,
      events_synced: 0,
    })
  }

  // Create email_scans entry if not exists
  const { data: existing } = await supabaseAdmin.from('email_scans').select('id').eq('account', account).single()
  if (!existing) {
    await supabaseAdmin.from('email_scans').insert({
      account,
      last_scanned_at: new Date().toISOString(),
      emails_processed: 0,
      action_items_found: 0,
    })
  }

  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/settings/email?connected=${account}`)
}
