export async function extractPdfText(buffer: Buffer): Promise<string> {
  const { extractText } = await import('unpdf')
  const result = await extractText(new Uint8Array(buffer))
  // result.text is an array of strings, one per page
  if (Array.isArray(result.text)) {
    return result.text.join('\n\n')
  }
  return String(result.text || '')
}

export async function ocrPdfWithAI(buffer: Buffer): Promise<string> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: process.env.ANTHROPIC_BASE_URL,
  })

  const response = await client.messages.create({
    model: 'google/gemini-2.0-flash-001',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: buffer.toString('base64'),
          },
        } as any,
        {
          type: 'text',
          text: 'Extract all text from this PDF document. Return only the extracted text with no commentary, formatting markup, or preamble.',
        },
      ],
    }],
  })

  const block = response.content.find(b => b.type === 'text')
  return block && block.type === 'text' ? block.text : ''
}
