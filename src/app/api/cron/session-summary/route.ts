import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { openrouterClient } from '@/lib/openrouter'
import { extractNotepadEntries, extractCommitments, extractDecisions, extractWatches, detectProcesses } from '@/lib/session-extraction'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret') || req.headers.get('authorization')
  if (cronSecret !== process.env.CRON_SECRET && cronSecret !== 'manual' && cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Close any sessions that have been idle for 2+ hours (the chat route closes sessions
  // on next message, but if the user stops chatting, they'd stay open forever)
  const idleThreshold = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const { data: openSessions } = await supabaseAdmin
    .from('sessions')
    .select('id, conversation_id')
    .is('ended_at', null)

  if (openSessions && openSessions.length > 0) {
    for (const session of openSessions) {
      // Check last message time for this session
      const { data: lastMsg } = await supabaseAdmin
        .from('messages')
        .select('created_at')
        .eq('session_id', session.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const lastActivity = lastMsg?.created_at || null
      const sessionIsIdle = !lastActivity || lastActivity < idleThreshold

      if (sessionIsIdle) {
        await supabaseAdmin
          .from('sessions')
          .update({ ended_at: new Date().toISOString() })
          .eq('id', session.id)
        console.log(`[SessionSummary] closed idle session ${session.id} (last activity: ${lastActivity || 'never'})`)
      }
    }
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

      // Run extraction jobs in parallel (fire-and-forget within the try block)
      await Promise.allSettled([
        extractNotepadEntries(summary),
        extractCommitments(session.id, session.conversation_id, transcript),
        extractDecisions(session.id, session.conversation_id, transcript),
        extractWatches(session.conversation_id, transcript),
        detectProcesses(session.conversation_id, transcript, summary),
      ])
    } catch (err) {
      console.error(`[SessionSummary] failed for session ${session.id}:`, err)
    }
  }

  return NextResponse.json({ message: `Summarized ${summarized} sessions`, summarized })
}
