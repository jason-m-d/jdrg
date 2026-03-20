import { supabaseAdmin } from './supabase'
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
