import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { openrouterClient } from '@/lib/openrouter'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret') || req.headers.get('authorization')
  if (cronSecret !== process.env.CRON_SECRET && cronSecret !== 'manual' && cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Find closed sessions that haven't been summarized yet
  const { data: unsummarized } = await supabaseAdmin
    .from('sessions')
    .select('id, conversation_id')
    .not('ended_at', 'is', null)
    .is('summary', null)
    .order('ended_at', { ascending: false })
    .limit(5)

  if (!unsummarized || unsummarized.length === 0) {
    return NextResponse.json({ message: 'No sessions to summarize', summarized: 0 })
  }

  let summarized = 0

  for (const session of unsummarized) {
    try {
      // Load messages for this session
      const { data: messages } = await supabaseAdmin
        .from('messages')
        .select('role, content, created_at')
        .eq('session_id', session.id)
        .order('created_at', { ascending: true })

      if (!messages || messages.length === 0) {
        // No messages — mark with empty summary so we don't retry
        await supabaseAdmin
          .from('sessions')
          .update({ summary: '(no messages)' })
          .eq('id', session.id)
        continue
      }

      const transcript = messages
        .map(m => `${m.role === 'user' ? 'Jason' : 'Crosby'}: ${(m.content || '').slice(0, 500)}`)
        .join('\n\n')

      const response = await openrouterClient.chat.completions.create({
        model: 'google/gemini-3.1-flash-lite-preview',
        max_tokens: 800,
        messages: [
          {
            role: 'system',
            content: 'Summarize this conversation session for Jason DeMayo\'s AI workspace. Write bullet points under 400 words. Focus on: decisions made, information shared, action items created or discussed, open questions, and anything Crosby should remember for the next session. Be specific - include names, numbers, and dates.',
          },
          { role: 'user', content: transcript },
        ],
        ...({
          models: ['google/gemini-3.1-flash-lite-preview', 'google/gemini-3-flash-preview'],
          provider: { sort: 'price' },
        } as any),
      })

      const summary = response.choices?.[0]?.message?.content || ''
      if (!summary) continue

      await supabaseAdmin
        .from('sessions')
        .update({ summary })
        .eq('id', session.id)

      summarized++
      console.log(`[SessionSummary] summarized session ${session.id} (${messages.length} messages)`)
    } catch (err) {
      console.error(`[SessionSummary] failed for session ${session.id}:`, err)
    }
  }

  return NextResponse.json({ message: `Summarized ${summarized} sessions`, summarized })
}
