import { supabaseAdmin } from './supabase'

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
export async function insertProactiveMessage(conversationId: string, content: string) {
  await supabaseAdmin.from('messages').insert({
    conversation_id: conversationId,
    role: 'assistant',
    content,
  })

  // Touch conversation timestamp so it surfaces
  await supabaseAdmin
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId)
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
