import Anthropic from '@anthropic-ai/sdk'

export async function executeWebSearch(query: string): Promise<string> {
  console.log(`[WebSearch] Calling Perplexity with query: "${query}"`)
  const searchClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL })
  const response = await searchClient.messages.create({
    model: 'perplexity/sonar-pro-search',
    max_tokens: 1024,
    messages: [{ role: 'user', content: query }],
    ...({ extra_body: { provider: { sort: 'price' } } } as any),
  })
  const result = response.content[0].type === 'text' ? response.content[0].text : 'No results found.'
  console.log(`[WebSearch] Perplexity response (${result.length} chars): ${result.slice(0, 200)}...`)
  return result
}
