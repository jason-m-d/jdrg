import { supabaseAdmin } from './supabase'
import { openrouterClient } from './openrouter'
import type { NotificationRule } from './types'

/**
 * Find the main (non-project) conversation, most recent, or create one.
 */
export async function getMainConversation(): Promise<string> {
  const { data: conv } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .is('project_id', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .single()

  if (conv) return conv.id

  // Create a new main conversation
  const { data: newConv } = await supabaseAdmin
    .from('conversations')
    .insert({ title: 'Main' })
    .select()
    .single()

  return newConv!.id
}

/**
 * Insert a proactive assistant message into a conversation.
 */
export async function insertProactiveMessage(conversationId: string, content: string, messageType?: string) {
  await supabaseAdmin.from('messages').insert({
    conversation_id: conversationId,
    role: 'assistant',
    content,
    ...(messageType ? { message_type: messageType } : {}),
  })

  // Touch conversation timestamp so it surfaces
  await supabaseAdmin
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId)
}

/**
 * Rewrite a template-generated proactive message in a natural, conversational tone.
 * Used for watch matches and bridge status messages (briefing/nudge/alert are already AI-generated).
 * Falls back to the original content if the rewrite fails.
 */
export async function rewriteForTone(rawContent: string, context: {
  type: 'watch_match' | 'email_heads_up' | 'bridge_status'
  sender?: string
  subject?: string
  emailPreview?: string
  watchContext?: string
  confidence?: string
}): Promise<string> {
  try {
    const systemPrompt = context.type === 'bridge_status'
      ? `You're Crosby, Jason's AI chief of staff. Rewrite this iMessage bridge status notification in a brief, natural tone. Keep it under 3 sentences. Be direct but not robotic. Don't use bold or markdown formatting.`
      : `You're Crosby, Jason's AI chief of staff. Rewrite this watch match notification in a natural, conversational tone. Rules:
- Lead with WHO did WHAT: "${context.sender} got back to you about X" not "This is a direct follow-up from..."
- Quote the relevant part of the email in quotation marks on its own line
- Connect it briefly to what Jason cares about in plain English. Don't dump raw action item names or watch titles
- Never mention watches, matches, confidence levels, or system internals
- 3 lines max. No bold or markdown formatting.`

    const response = await openrouterClient.chat.completions.create({
      model: 'google/gemini-2.0-flash-001',
      max_tokens: 256,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: rawContent },
      ],
      ...({ models: ['google/gemini-2.0-flash-001', 'google/gemini-flash-1.5'], provider: { sort: 'price' } } as any),
    } as any)

    const rewritten = response.choices[0]?.message?.content?.trim()
    return rewritten || rawContent
  } catch {
    return rawContent
  }
}

/**
 * Check emails against active notification rules and return matches.
 */
export async function checkNotificationRules(
  emails: { from: string; subject: string; snippet?: string }[]
): Promise<{ rule: NotificationRule; email: { from: string; subject: string; snippet?: string } }[]> {
  const { data: rules } = await supabaseAdmin
    .from('notification_rules')
    .select('*')
    .eq('is_active', true)

  if (!rules || rules.length === 0) return []

  const matches: { rule: NotificationRule; email: { from: string; subject: string; snippet?: string } }[] = []

  for (const email of emails) {
    for (const rule of rules) {
      const val = rule.match_value.toLowerCase()
      let matched = false

      switch (rule.match_type) {
        case 'sender':
          matched = email.from.toLowerCase().includes(val)
          break
        case 'subject':
          matched = email.subject.toLowerCase().includes(val)
          break
        case 'keyword': {
          const searchIn = rule.match_field === 'subject'
            ? email.subject
            : rule.match_field === 'sender'
              ? email.from
              : `${email.from} ${email.subject} ${email.snippet || ''}`
          matched = searchIn.toLowerCase().includes(val)
          break
        }
      }

      if (matched) {
        matches.push({ rule, email })
      }
    }
  }

  return matches
}

/**
 * Get all user preferences (memories with category = 'preference').
 */
export async function getUserPreferences(): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('memories')
    .select('content')
    .eq('category', 'preference')
    .order('created_at', { ascending: false })

  return (data || []).map((m: any) => m.content)
}
