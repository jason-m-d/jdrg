import { supabaseAdmin } from './supabase'
import { chunkText } from './chunker'
import { generateEmbedding } from './voyage'

export async function chunkAndEmbedContext(contextId: string, content: string) {
  const chunks = chunkText(content)
  await supabaseAdmin.from('context_chunks').delete().eq('context_id', contextId)
  for (let i = 0; i < chunks.length; i++) {
    try {
      const embedding = await generateEmbedding(chunks[i])
      await supabaseAdmin.from('context_chunks').insert({
        context_id: contextId,
        chunk_index: i,
        content: chunks[i],
        embedding,
      })
    } catch (e) {
      console.error(`Failed to embed context chunk ${i}:`, e)
    }
  }
}
