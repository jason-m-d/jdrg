import { supabaseAdmin } from './supabase'
import { generateQueryEmbedding } from './embeddings'
import { rerankChunks } from './rerank'
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
  limit = 5,
  threshold = 0.6,
  precomputedEmbedding?: number[]
): Promise<ChunkWithMeta[]> {
  const embedding = precomputedEmbedding || await generateQueryEmbedding(query)

  // Retrieve wider pool for reranking (4x the final limit, min 20)
  const retrievalCount = Math.max(20, limit * 4)

  const { data, error } = await supabaseAdmin.rpc('match_documents', {
    query_embedding: embedding,
    match_threshold: threshold,
    match_count: retrievalCount,
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

  // Rerank via Cohere for better relevance ordering (falls back to cosine if unavailable)
  return rerankChunks(query, chunks, limit)
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

interface ContextChunkWithMeta {
  id: string
  context_id: string
  chunk_index: number
  content: string
  similarity: number
}

export async function retrieveRelevantContextChunks(
  query: string,
  projectId?: string,
  limit = 5,
  threshold = 0.6,
  precomputedEmbedding?: number[]
): Promise<ContextChunkWithMeta[]> {
  const embedding = precomputedEmbedding || await generateQueryEmbedding(query)

  const retrievalCount = Math.max(15, limit * 3)

  const { data, error } = await supabaseAdmin.rpc('match_context', {
    query_embedding: embedding,
    match_threshold: threshold,
    match_count: retrievalCount,
  })

  if (error) {
    console.error('Error retrieving context chunks:', error)
    return []
  }

  let chunks = (data as ContextChunkWithMeta[]) || []

  // If a specific project is provided, filter to only that project's chunks
  // Otherwise, return chunks from all projects (for main chat cross-project retrieval)
  if (projectId && chunks.length > 0) {
    const contextIds = [...new Set(chunks.map(c => c.context_id))]
    const { data: contexts } = await supabaseAdmin
      .from('project_context')
      .select('id')
      .in('id', contextIds)
      .eq('project_id', projectId)

    if (contexts) {
      const projectContextIds = new Set(contexts.map(c => c.id))
      chunks = chunks.filter(c => projectContextIds.has(c.context_id))
    }
  }

  return rerankChunks(query, chunks, limit)
}

interface DecisionWithSimilarity {
  id: string
  session_id: string | null
  conversation_id: string | null
  project_id: string | null
  decision_text: string
  context: string | null
  alternatives_considered: string | null
  decided_at: string
  similarity: number
}

export async function retrieveRelevantDecisions(
  query: string,
  limit = 5,
  threshold = 0.6,
  precomputedEmbedding?: number[]
): Promise<DecisionWithSimilarity[]> {
  const embedding = precomputedEmbedding || await generateQueryEmbedding(query)

  const retrievalCount = Math.max(15, limit * 3)

  const { data, error } = await supabaseAdmin.rpc('match_decisions', {
    query_embedding: embedding,
    match_threshold: threshold,
    match_count: retrievalCount,
  })

  if (error) {
    console.error('Error retrieving decisions:', error)
    return []
  }

  const decisions = (data as DecisionWithSimilarity[]) || []
  return rerankChunks(query, decisions.map(d => ({ ...d, content: d.decision_text })), limit)
    .then(reranked => reranked.map(r => decisions.find(d => d.id === r.id)!).filter(Boolean))
}

export function buildContext(
  chunks: ChunkWithMeta[],
  pinnedDocs: Document[],
  memories: Memory[],
  contextChunks?: ContextChunkWithMeta[]
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

  if (contextChunks && contextChunks.length > 0) {
    const ctxSection = contextChunks
      .map(
        (c, i) =>
          `[Context ${i + 1}, context_id: ${c.context_id}, similarity: ${c.similarity.toFixed(3)}]\n${c.content}`
      )
      .join('\n\n')
    parts.push(`## Project Context\n${ctxSection}`)
  }

  if (memories.length > 0) {
    const memorySection = memories
      .map((m) => `- [${m.category || 'general'}] ${m.content}`)
      .join('\n')
    parts.push(`## Memories\n${memorySection}`)
  }

  return parts.join('\n\n')
}
