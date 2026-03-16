import { supabaseAdmin } from './supabase'
import { generateQueryEmbedding } from './voyage'
import type { Document, Memory } from './types'

interface ChunkWithMeta {
  id: string
  document_id: string
  chunk_index: number
  content: string
  similarity: number
}

export async function retrieveRelevantChunks(
  query: string,
  projectId?: string,
  limit = 8,
  threshold = 0.7
): Promise<ChunkWithMeta[]> {
  const embedding = await generateQueryEmbedding(query)

  const { data, error } = await supabaseAdmin.rpc('match_documents', {
    query_embedding: embedding,
    match_threshold: threshold,
    match_count: limit,
  })

  if (error) {
    console.error('Error retrieving chunks:', error)
    return []
  }

  let chunks = (data as ChunkWithMeta[]) || []

  // Filter by project if specified
  if (projectId && chunks.length > 0) {
    const docIds = [...new Set(chunks.map((c) => c.document_id))]
    const { data: docs } = await supabaseAdmin
      .from('documents')
      .select('id')
      .in('id', docIds)
      .eq('project_id', projectId)

    if (docs) {
      const projectDocIds = new Set(docs.map((d) => d.id))
      chunks = chunks.filter((c) => projectDocIds.has(c.document_id))
    }
  }

  return chunks
}

export async function getPinnedDocuments(
  projectId: string
): Promise<Document[]> {
  const { data, error } = await supabaseAdmin
    .from('documents')
    .select('*')
    .eq('project_id', projectId)
    .eq('is_pinned', true)

  if (error) {
    console.error('Error fetching pinned docs:', error)
    return []
  }

  return (data as Document[]) || []
}

export async function getRelevantMemories(
  query: string,
  limit = 5
): Promise<Memory[]> {
  // For now, return the most recent memories
  // TODO: add semantic search over memories
  const { data, error } = await supabaseAdmin
    .from('memories')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('Error fetching memories:', error)
    return []
  }

  return (data as Memory[]) || []
}

export function buildContext(
  chunks: ChunkWithMeta[],
  pinnedDocs: Document[],
  memories: Memory[]
): string {
  const parts: string[] = []

  if (pinnedDocs.length > 0) {
    const pinnedSection = pinnedDocs
      .map((doc) => {
        const preview = doc.content
          ? doc.content.slice(0, 2000)
          : '(no content)'
        return `### ${doc.title}\n${preview}`
      })
      .join('\n\n')
    parts.push(`## Pinned Documents\n${pinnedSection}`)
  }

  if (chunks.length > 0) {
    const chunkSection = chunks
      .map(
        (c, i) =>
          `[Chunk ${i + 1}, similarity: ${c.similarity.toFixed(3)}]\n${c.content}`
      )
      .join('\n\n')
    parts.push(`## Retrieved Context\n${chunkSection}`)
  }

  if (memories.length > 0) {
    const memorySection = memories
      .map((m) => `- [${m.category || 'general'}] ${m.content}`)
      .join('\n')
    parts.push(`## Memories\n${memorySection}`)
  }

  return parts.join('\n\n')
}
