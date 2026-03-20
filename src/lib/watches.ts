import { supabaseAdmin } from './supabase'
import { openrouterClient } from './openrouter'

// Jason's emails - filter out self-sent emails
const JASON_EMAILS = ['jason@demayorestaurantgroup.com', 'jason@hungryhospitality.com', 'jasondemayo@gmail.com', 'jason@hungry.llc']

interface ProcessedEmail {
  id: string
  threadId: string
  subject: string
  from: string
  to: string
  body: string
  internalDate: string
}

interface Watch {
  id: string
  watch_type: string
  match_criteria: {
    thread_id?: string | null
    sender_email?: string | null
    sender_domain?: string | null
    keywords?: string[]
    semantic_context?: string
  }
  context: string
  priority: string
  status: string
  source_thread_id?: string | null
  conversation_id?: string | null
}

export interface WatchMatch {
  watchId: string
  emailId: string
  confidence: 'high' | 'medium' | 'ai'
  layer: 1 | 2 | 3
  explanation?: string
  watch: Watch
  email: ProcessedEmail
}

function extractDomain(emailStr: string): string {
  const match = emailStr.match(/@([^>]+)/)
  return match ? match[1].toLowerCase().trim() : ''
}

function extractEmail(headerValue: string): string {
  const match = headerValue.match(/<([^>]+)>/)
  return (match ? match[1] : headerValue).toLowerCase().trim()
}

/**
 * Check all active watches against a batch of incoming emails.
 * Returns matches found across all three layers.
 */
export async function checkWatchesAgainstEmails(
  emails: ProcessedEmail[],
  _userId: string,
): Promise<WatchMatch[]> {
  // Filter out emails from Jason himself
  const inboundEmails = emails.filter(e => {
    const sender = extractEmail(e.from)
    return !JASON_EMAILS.includes(sender)
  })

  if (inboundEmails.length === 0) return []

  // Load active watches
  const { data: watches } = await supabaseAdmin
    .from('conversation_watches')
    .select('*')
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())

  if (!watches || watches.length === 0) return []

  const allMatches: WatchMatch[] = []
  const matchedEmailIds = new Set<string>()
  const matchedWatchEmailPairs = new Set<string>()

  // LAYER 1: Metadata matching (fast, zero cost)
  for (const email of inboundEmails) {
    const senderEmail = extractEmail(email.from)
    const senderDomain = extractDomain(email.from)

    for (const watch of watches) {
      const criteria = watch.match_criteria as Watch['match_criteria']
      let matched = false

      // Thread ID match
      if (criteria.thread_id && email.threadId === criteria.thread_id) {
        matched = true
      }

      // Sender email match
      if (!matched && criteria.sender_email && senderEmail === criteria.sender_email.toLowerCase()) {
        matched = true
      }

      // Sender domain match
      if (!matched && criteria.sender_domain && senderDomain === criteria.sender_domain.toLowerCase()) {
        matched = true
      }

      if (matched) {
        const pairKey = `${watch.id}:${email.id}`
        if (!matchedWatchEmailPairs.has(pairKey)) {
          matchedWatchEmailPairs.add(pairKey)
          matchedEmailIds.add(email.id)
          allMatches.push({
            watchId: watch.id,
            emailId: email.id,
            confidence: 'high',
            layer: 1,
            watch,
            email,
          })
        }
      }
    }
  }

  // LAYER 2: Keyword/entity overlap (fast, zero cost)
  for (const email of inboundEmails) {
    for (const watch of watches) {
      const pairKey = `${watch.id}:${email.id}`
      if (matchedWatchEmailPairs.has(pairKey)) continue

      const criteria = watch.match_criteria as Watch['match_criteria']
      const keywords = criteria.keywords
      if (!keywords || keywords.length === 0) continue

      const emailText = `${email.subject} ${email.body.slice(0, 500)}`.toLowerCase()
      let hits = 0

      for (const keyword of keywords) {
        const kw = keyword.toLowerCase()
        if (emailText.includes(kw)) hits++
      }

      if (hits >= 2) {
        matchedWatchEmailPairs.add(pairKey)
        matchedEmailIds.add(email.id)
        allMatches.push({
          watchId: watch.id,
          emailId: email.id,
          confidence: 'medium',
          layer: 2,
          watch,
          email,
        })
      }
    }
  }

  // LAYER 3: Semantic AI matching (one cheap batch call)
  const unmatchedEmails = inboundEmails.filter(e => !matchedEmailIds.has(e.id))
  const watchesWithSemantic = watches.filter(w => {
    const criteria = w.match_criteria as Watch['match_criteria']
    return criteria.semantic_context && criteria.semantic_context.length > 0
  })

  if (unmatchedEmails.length > 0 && watchesWithSemantic.length > 0) {
    // Cap at 20 emails to keep prompt small
    const emailBatch = unmatchedEmails.slice(0, 20)

    const watchDescriptions = watchesWithSemantic.map((w, i) => {
      const criteria = w.match_criteria as Watch['match_criteria']
      return `Watch ${i} (id: ${w.id}): ${criteria.semantic_context}`
    }).join('\n')

    const emailDescriptions = emailBatch.map((e, i) =>
      `Email ${i} (id: ${e.id}): From: ${e.from} | Subject: ${e.subject} | Preview: ${e.body.slice(0, 300)}`
    ).join('\n\n')

    try {
      const response = await openrouterClient.chat.completions.create({
        model: 'google/gemini-3.1-flash-lite-preview',
        max_tokens: 1024,
        messages: [
          {
            role: 'system',
            content: `You are matching incoming emails against a list of things Jason is waiting for or monitoring. For each email, determine if it is related to any watch. Consider that replies may come from different people than expected, on different threads, using different language. Only return matches you are confident about (confidence > 70).`,
          },
          {
            role: 'user',
            content: `WATCHES:\n${watchDescriptions}\n\nEMAILS:\n${emailDescriptions}\n\nReturn matches as JSON.`,
          },
        ],
        models: ['google/gemini-3.1-flash-lite-preview', 'google/gemini-3-flash-preview'],
        provider: { sort: 'price' },
        plugins: [{ id: 'response-healing' }],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'response',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                matches: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      email_index: { type: 'number' },
                      watch_id: { type: 'string' },
                      confidence: { type: 'number' },
                      explanation: { type: 'string' },
                    },
                    required: ['email_index', 'watch_id', 'confidence', 'explanation'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['matches'],
              additionalProperties: false,
            },
          },
        },
      } as any)

      const text = response.choices[0]?.message?.content || ''
      let parsed: { matches: { email_index: number; watch_id: string; confidence: number; explanation: string }[] }

      try {
        parsed = JSON.parse(text)
      } catch {
        let cleaned = text.trim()
        if (cleaned.startsWith('```')) {
          cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
        }
        const match = cleaned.match(/\{[\s\S]*\}/)
        parsed = match ? JSON.parse(match[0]) : JSON.parse(cleaned)
      }

      if (parsed.matches) {
        for (const m of parsed.matches) {
          if (m.confidence <= 70) continue
          if (m.email_index < 0 || m.email_index >= emailBatch.length) continue

          const email = emailBatch[m.email_index]
          const watch = watchesWithSemantic.find(w => w.id === m.watch_id)
          if (!email || !watch) continue

          const pairKey = `${watch.id}:${email.id}`
          if (matchedWatchEmailPairs.has(pairKey)) continue
          matchedWatchEmailPairs.add(pairKey)

          allMatches.push({
            watchId: watch.id,
            emailId: email.id,
            confidence: 'ai',
            layer: 3,
            explanation: m.explanation,
            watch,
            email,
          })
        }
      }
    } catch (e: any) {
      console.error('[watches] Layer 3 AI matching failed:', e.message?.slice(0, 200))
    }
  }

  return allMatches
}

/**
 * Build a proactive message for a watch match.
 */
export function buildWatchMessage(match: WatchMatch): string {
  const sender = match.email.from.replace(/<[^>]+>/, '').trim()
  const subject = match.email.subject
  const context = match.watch.context
  const preview = match.email.body.slice(0, 200).replace(/\n+/g, ' ').trim()

  if (match.confidence === 'high') {
    return `Heads up - ${sender} just emailed about "${subject}". ${preview}${preview.length >= 200 ? '...' : ''}\n\nThis is what you were waiting for from your ${context}.`
  } else if (match.confidence === 'medium') {
    return `Possible match - ${sender} emailed about "${subject}". ${preview}${preview.length >= 200 ? '...' : ''}\n\nCould be related to your ${context}.`
  } else {
    return `Possible match - ${match.explanation || `${sender} emailed about "${subject}"`}. ${preview}${preview.length >= 200 ? '...' : ''}\n\nMay be related to your ${context}.`
  }
}

/**
 * Extract meaningful keywords from a subject line (strip Re:, Fwd:, stopwords).
 */
export function extractSubjectKeywords(subject: string): string[] {
  const stopWords = new Set([
    're', 'fwd', 'fw', 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be',
    'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'could', 'should', 'may', 'might', 'can', 'shall', 'to', 'of',
    'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about',
    'and', 'but', 'or', 'not', 'no', 'so', 'if', 'then', 'than', 'that',
    'this', 'it', 'its', 'my', 'your', 'his', 'her', 'our', 'their',
    'i', 'you', 'he', 'she', 'we', 'they', 'me', 'him', 'us', 'them',
    'up', 'out', 'just', 'also', 'very', 'all', 'any', 'hi', 'hello',
    'hey', 'thanks', 'thank', 'please', 'regards',
  ])

  const cleaned = subject
    .replace(/^(re|fwd|fw)\s*:\s*/gi, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .toLowerCase()

  return cleaned
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))
    .slice(0, 5)
}

/**
 * Create an auto-watch from an outbound email thread.
 */
export async function createAutoWatch(
  threadId: string,
  recipientEmail: string,
  subject: string,
  userId?: string,
): Promise<void> {
  // Don't duplicate - check if watch already exists for this thread
  const { data: existing } = await supabaseAdmin
    .from('conversation_watches')
    .select('id')
    .eq('source_thread_id', threadId)
    .eq('status', 'active')
    .limit(1)

  if (existing && existing.length > 0) return

  const recipientDomain = extractDomain(recipientEmail)
  const keywords = extractSubjectKeywords(subject)
  const now = new Date()
  const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  await supabaseAdmin.from('conversation_watches').insert({
    user_id: userId || null,
    watch_type: 'email_reply',
    match_criteria: {
      thread_id: threadId,
      sender_domain: recipientDomain || null,
      keywords,
      semantic_context: `Sent email to ${recipientEmail} about "${subject}" on ${dateStr}`,
    },
    context: subject,
    priority: 'high',
    source_thread_id: threadId,
    expires_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  })
}
