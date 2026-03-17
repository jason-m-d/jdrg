export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'voyage-3',
      input: text,
      input_type: 'document',
    }),
  })
  const data = await response.json()
  if (!data.data?.[0]?.embedding) {
    console.error('Voyage embedding failed:', JSON.stringify(data).slice(0, 200))
    throw new Error('Embedding generation failed')
  }
  return data.data[0].embedding
}

export async function generateQueryEmbedding(text: string): Promise<number[]> {
  const response = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'voyage-3',
      input: text,
      input_type: 'query',
    }),
  })
  const data = await response.json()
  if (!data.data?.[0]?.embedding) {
    console.error('Voyage query embedding failed:', JSON.stringify(data).slice(0, 200))
    throw new Error('Query embedding generation failed')
  }
  return data.data[0].embedding
}
