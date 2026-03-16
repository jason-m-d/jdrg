function estimateTokens(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length
  return Math.ceil(words * 1.3)
}

function splitIntoParagraphs(text: string): string[] {
  return text.split(/\n\s*\n/).filter((p) => p.trim().length > 0)
}

function splitIntoSentences(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+\s*/g)
  if (!parts) return [text]
  return parts.map((s) => s.trim()).filter(Boolean)
}

export function chunkText(
  text: string,
  maxTokens = 500,
  overlapTokens = 50
): string[] {
  const paragraphs = splitIntoParagraphs(text)
  const chunks: string[] = []
  let currentChunk = ''
  let overlapBuffer = ''

  for (const paragraph of paragraphs) {
    const paragraphTokens = estimateTokens(paragraph)

    // If a single paragraph exceeds max tokens, split it by sentences
    if (paragraphTokens > maxTokens) {
      // Flush current chunk first
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim())
        overlapBuffer = extractOverlap(currentChunk, overlapTokens)
        currentChunk = overlapBuffer
      }

      const sentences = splitIntoSentences(paragraph)
      for (const sentence of sentences) {
        const sentenceTokens = estimateTokens(sentence)

        // If a single sentence exceeds max tokens, split by character count
        if (sentenceTokens > maxTokens) {
          if (currentChunk.trim()) {
            chunks.push(currentChunk.trim())
            overlapBuffer = extractOverlap(currentChunk, overlapTokens)
            currentChunk = overlapBuffer
          }

          const subChunks = splitByTokenCount(sentence, maxTokens, overlapTokens)
          for (const sub of subChunks) {
            chunks.push(sub.trim())
          }
          overlapBuffer = extractOverlap(
            subChunks[subChunks.length - 1],
            overlapTokens
          )
          currentChunk = overlapBuffer
          continue
        }

        const combined = currentChunk
          ? currentChunk + ' ' + sentence
          : sentence
        if (estimateTokens(combined) > maxTokens) {
          chunks.push(currentChunk.trim())
          overlapBuffer = extractOverlap(currentChunk, overlapTokens)
          currentChunk = overlapBuffer + ' ' + sentence
        } else {
          currentChunk = combined
        }
      }
      continue
    }

    const combined = currentChunk
      ? currentChunk + '\n\n' + paragraph
      : paragraph
    if (estimateTokens(combined) > maxTokens) {
      chunks.push(currentChunk.trim())
      overlapBuffer = extractOverlap(currentChunk, overlapTokens)
      currentChunk = overlapBuffer + '\n\n' + paragraph
    } else {
      currentChunk = combined
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim())
  }

  return chunks
}

function extractOverlap(text: string, overlapTokens: number): string {
  const words = text.split(/\s+/)
  const overlapWords = Math.ceil(overlapTokens / 1.3)
  if (words.length <= overlapWords) return text
  return words.slice(-overlapWords).join(' ')
}

function splitByTokenCount(
  text: string,
  maxTokens: number,
  overlapTokens: number
): string[] {
  const words = text.split(/\s+/)
  const maxWords = Math.floor(maxTokens / 1.3)
  const overlapWords = Math.ceil(overlapTokens / 1.3)
  const chunks: string[] = []
  let start = 0

  while (start < words.length) {
    const end = Math.min(start + maxWords, words.length)
    chunks.push(words.slice(start, end).join(' '))
    if (end >= words.length) break
    start = end - overlapWords
  }

  return chunks
}
