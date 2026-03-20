import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateEmbedding } from '@/lib/embeddings'
import { logCronJob } from '@/lib/activity-log'

export const maxDuration = 60

const BATCH_SIZE = 50
const MIN_LENGTH = 20 // skip very short messages

export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret') || req.headers.get('authorization')
  if (cronSecret !== process.env.CRON_SECRET && cronSecret !== 'manual' && cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronStart = Date.now()

  // Find messages that haven't been embedded yet
  const { data: messages } = await supabaseAdmin
    .from('messages')
    .select('id, conversation_id, role, content')
    .is('embedded_at', null)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (!messages || messages.length === 0) {
    void logCronJob({ job_name: 'embed-messages', success: true, duration_ms: Date.now() - cronStart, summary: 'No messages to embed' })
    return NextResponse.json({ message: 'No messages to embed', embedded: 0 })
  }

  let embedded = 0

  for (const msg of messages) {
    try {
      const content = (msg.content || '').trim()

      // Skip very short messages and error messages
      if (content.length < MIN_LENGTH) {
        await supabaseAdmin.from('messages').update({ embedded_at: new Date().toISOString() }).eq('id', msg.id)
        continue
      }

      // Most chat messages fit in one chunk. Split long assistant responses.
      const chunks = chunkContent(content)

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        const embedding = await generateEmbedding(chunk)

        await supabaseAdmin.from('message_embeddings').insert({
          message_id: msg.id,
          conversation_id: msg.conversation_id,
          chunk_index: i,
          content: chunk,
          embedding,
        })
      }

      // Mark message as embedded
      await supabaseAdmin.from('messages').update({ embedded_at: new Date().toISOString() }).eq('id', msg.id)
      embedded++
    } catch (err) {
      console.error(`[embed-messages] failed for message ${msg.id}:`, err)
      // Don't mark embedded_at so it retries next run
    }
  }

  void logCronJob({ job_name: 'embed-messages', success: true, duration_ms: Date.now() - cronStart, summary: `Embedded ${embedded} messages` })
  return NextResponse.json({ message: `Embedded ${embedded} messages`, embedded })
}

// Chunk long content into ~1500 char pieces with overlap
function chunkContent(text: string, maxChars = 1500, overlap = 200): string[] {
  if (text.length <= maxChars) return [text]

  const chunks: string[] = []
  let start = 0

  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length)
    chunks.push(text.slice(start, end))
    start = end - overlap
    if (start >= text.length) break
  }

  return chunks
}
