export async function extractPdfText(buffer: Buffer): Promise<string> {
  const { extractText } = await import('unpdf')
  const result = await extractText(new Uint8Array(buffer))
  // result.text is an array of strings, one per page
  if (Array.isArray(result.text)) {
    return result.text.join('\n\n')
  }
  return String(result.text || '')
}
