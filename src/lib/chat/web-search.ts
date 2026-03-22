import Anthropic from '@anthropic-ai/sdk'
import { SEARCH_MODELS, buildMetadata } from '@/lib/openrouter-models'

export interface Citation {
  url: string
  title: string
  snippet: string
  domain: string
}

export interface SearchResult {
  result: string
  citations: Citation[]
}

function extractCitations(response: Anthropic.Message): Citation[] {
  try {
    // Perplexity returns citations in response metadata — access via raw response body
    const raw = response as any
    const urls: string[] = raw?.citations ?? raw?.meta?.citations ?? []
    return urls.map((url: string) => {
      let domain = ''
      try { domain = new URL(url).hostname.replace('www.', '') } catch { domain = url }
      return { url, title: domain, snippet: '', domain }
    })
  } catch {
    return []
  }
}

export async function executeWebSearch(query: string): Promise<SearchResult> {
  console.log(`[WebSearch] Calling Perplexity with query: "${query}"`)
  const searchClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL })
  const response = await searchClient.messages.create({
    model: SEARCH_MODELS.quick,
    max_tokens: 1024,
    messages: [{ role: 'user', content: query }],
    ...({ extra_body: { provider: SEARCH_MODELS.provider, metadata: buildMetadata({ call_type: 'web_search' }) } } as any),
  })
  const result = response.content[0].type === 'text' ? response.content[0].text : 'No results found.'
  const citations = extractCitations(response)
  console.log(`[WebSearch] Perplexity response (${result.length} chars, ${citations.length} citations): ${result.slice(0, 200)}...`)
  return { result, citations }
}

export async function executeDeepResearch(query: string): Promise<SearchResult> {
  console.log(`[DeepResearch] Calling Perplexity deep research with query: "${query}"`)
  const searchClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL })
  const response = await searchClient.messages.create({
    model: SEARCH_MODELS.deep,
    max_tokens: 8192,
    messages: [{ role: 'user', content: query }],
    ...({ extra_body: { provider: SEARCH_MODELS.provider, metadata: buildMetadata({ call_type: 'web_search' }) } } as any),
  })
  const result = response.content[0].type === 'text' ? response.content[0].text : 'No results found.'
  const citations = extractCitations(response)
  console.log(`[DeepResearch] Perplexity response (${result.length} chars, ${citations.length} citations)`)
  return { result, citations }
}
