import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchEmails } from '@/lib/gmail'

export async function GET() {
  try {
    // Get first connected Gmail account
    const { data: tokenRow } = await supabaseAdmin
      .from('google_tokens')
      .select('account')
      .limit(1)
      .single()

    if (!tokenRow) {
      return NextResponse.json({ snippets: [], message: 'No Gmail account connected' })
    }

    // Fetch recent emails (last 3 days)
    const since = new Date(Date.now() - 3 * 24 * 3600000)
    const emails = await fetchEmails(tokenRow.account, since)

    if (emails.length === 0) {
      return NextResponse.json({ snippets: [], message: 'No recent emails found' })
    }

    // Get IDs of emails that already have action items
    const { data: existingItems } = await supabaseAdmin
      .from('action_items')
      .select('source_id')
      .eq('source', 'email')
      .not('source_id', 'is', null)

    const flaggedEmailIds = new Set((existingItems || []).map((i: any) => i.source_id))

    // Build snippets with label hints
    const snippets = emails.slice(0, 20).map(email => ({
      text: `From: ${email.from}\nSubject: ${email.subject}\n\n${email.body.slice(0, 500)}`,
      source_type: 'email' as const,
      has_action_item: flaggedEmailIds.has(email.id),
      metadata: { email_id: email.id, subject: email.subject, from: email.from },
    }))

    // Shuffle and take ~10
    const shuffled = snippets.sort(() => Math.random() - 0.5).slice(0, 10)

    return NextResponse.json({ snippets: shuffled })
  } catch (e: any) {
    console.error('Teach-me error:', e)
    return NextResponse.json({ snippets: [], message: e.message || 'Failed to load snippets' })
  }
}
