/**
 * Cohere Rerank integration for RAG pipeline.
 *
 * Reranks cosine-similarity results from pgvector using Cohere's
 * cross-encoder model, which understands the relationship between
 * the query and each chunk more deeply than embedding similarity.
 *
 * Usage:
 *   const reranked = await rerankChunks(query, chunks, 5)
 *
 * Graceful fallback: any error (API down, timeout, invalid key) returns
 * the original cosine-ranked list unchanged. RAG never breaks.
 */

import { CohereClient } from 'cohere-ai'
import { reportCronFailure } from './cron-alerting'

const RERANK_TIMEOUT_MS = 500
const RERANK_MODEL = 'rerank-v3.5'

let _client: CohereClient | null = null

function getCohereClient(): CohereClient {
  if (!_client) {
    _client = new CohereClient({ token: process.env.COHERE_API_KEY })
  }
  return _client
}

export async function rerankChunks<T extends { content: string }>(
  query: string,
  chunks: T[],
  topN: number
): Promise<T[]> {
  if (!chunks.length) return chunks
  if (!process.env.COHERE_API_KEY) {
    console.warn('[rerank] COHERE_API_KEY not set, skipping rerank')
    return chunks.slice(0, topN)
  }

  const timeout = new Promise<T[]>((resolve) => {
    setTimeout(() => {
      console.warn(`[rerank] Cohere timeout after ${RERANK_TIMEOUT_MS}ms, returning cosine results`)
      resolve(chunks.slice(0, topN))
    }, RERANK_TIMEOUT_MS)
  })

  const rerank = (async () => {
    const client = getCohereClient()
    const response = await client.rerank({
      model: RERANK_MODEL,
      query,
      documents: chunks.map(c => c.content),
      topN,
    })

    const reranked = response.results
      .sort((a, b) => a.index - b.index) // results come back sorted by relevance score, re-sort by original index first
      .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0)) // now sort by relevance score descending
      .slice(0, topN)
      .map(r => chunks[r.index])

    return reranked
  })()

  try {
    return await Promise.race([rerank, timeout])
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = err?.status ?? err?.statusCode
    if (status === 429 || msg.includes('rate limit') || msg.includes('too many requests')) {
      console.warn('[rerank] Cohere rate limit hit (trial key) — falling back to cosine results. Consider upgrading to paid plan.')
      // Alert via push + proactive message (cron-alerting rate-limits to 1/hour, so this won't spam)
      void reportCronFailure('cohere-rerank', new Error('Cohere trial API rate limit hit. RAG is falling back to cosine ranking. Upgrade at dashboard.cohere.com to restore reranking.'))
    } else {
      console.error('[rerank] Cohere rerank failed, falling back to cosine results:', msg)
    }
    return chunks.slice(0, topN)
  }
}
