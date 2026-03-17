import { supabaseAdmin } from '@/lib/supabase'
import { generateEmbedding, generateQueryEmbedding } from '@/lib/voyage'
import type { TrainingRule } from '@/lib/types'

/**
 * Retrieve the most similar labeled training examples for a given snippet.
 */
export async function getRelevantTrainingExamples(
  snippet: string,
  limit = 5,
  precomputedEmbedding?: number[]
): Promise<{ id: string; snippet: string; is_action_item: boolean; similarity: number }[]> {
  try {
    const embedding = precomputedEmbedding || await generateQueryEmbedding(snippet.slice(0, 2000))

    const { data, error } = await supabaseAdmin.rpc('match_training_examples', {
      query_embedding: embedding,
      match_threshold: 0.3,
      match_count: limit,
    })

    if (error) {
      console.error('match_training_examples RPC failed:', error.message)
      return []
    }

    return data || []
  } catch (e) {
    console.error('getRelevantTrainingExamples failed:', e)
    return []
  }
}

/**
 * Fetch all active training rules.
 */
export async function getActiveRules(): Promise<TrainingRule[]> {
  const { data } = await supabaseAdmin
    .from('training_rules')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  return data || []
}

/**
 * Build a few-shot prompt block from similar training examples + active rules.
 * Returns null if no examples or rules exist (nothing to inject).
 */
export async function buildFewShotBlock(snippet: string, precomputedEmbedding?: number[]): Promise<string | null> {
  const [examples, rules] = await Promise.all([
    getRelevantTrainingExamples(snippet, 5, precomputedEmbedding),
    getActiveRules(),
  ])

  if (examples.length === 0 && rules.length === 0) return null

  const parts: string[] = []
  parts.push('--- Learned Preferences ---')
  parts.push("Based on past feedback, here's what Jason considers action items:")

  if (examples.length > 0) {
    for (const ex of examples) {
      const label = ex.is_action_item ? 'YES' : 'NO'
      // Truncate long snippets for prompt space
      const text = ex.snippet.length > 200 ? ex.snippet.slice(0, 200) + '...' : ex.snippet
      parts.push(`${label}: "${text}"`)
    }
  }

  if (rules.length > 0) {
    const ruleTexts = rules.map(r => r.rule)
    parts.push('')
    parts.push(`Rules: ${ruleTexts.join('. ')}.`)
  }

  return parts.join('\n')
}

/**
 * Store a labeled training example with its vector embedding.
 */
export async function storeTrainingExample(
  snippet: string,
  isActionItem: boolean,
  labelSource: 'teach_me' | 'feedback' | 'implicit',
  sourceType?: 'email' | 'chat',
  metadata?: Record<string, unknown>,
  actionItemId?: string
): Promise<{ id: string }> {
  // Generate embedding for similarity search
  const embedding = await generateEmbedding(snippet.slice(0, 2000))

  const { data, error } = await supabaseAdmin
    .from('training_examples')
    .insert({
      snippet,
      is_action_item: isActionItem,
      label_source: labelSource,
      source_type: sourceType || null,
      embedding,
      metadata: metadata || {},
      action_item_id: actionItemId || null,
    })
    .select('id')
    .single()

  if (error) throw new Error(`Failed to store training example: ${error.message}`)
  return data
}

/**
 * Get training stats (total examples, breakdown by source, rules count).
 */
export async function getTrainingStats(): Promise<{
  total_examples: number
  by_source: { teach_me: number; feedback: number; implicit: number }
  rules_count: number
  ready_for_rules: boolean
}> {
  const [totalResult, teachMeResult, feedbackResult, implicitResult, rulesResult] = await Promise.all([
    supabaseAdmin.from('training_examples').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('training_examples').select('id', { count: 'exact', head: true }).eq('label_source', 'teach_me'),
    supabaseAdmin.from('training_examples').select('id', { count: 'exact', head: true }).eq('label_source', 'feedback'),
    supabaseAdmin.from('training_examples').select('id', { count: 'exact', head: true }).eq('label_source', 'implicit'),
    supabaseAdmin.from('training_rules').select('id', { count: 'exact', head: true }).eq('is_active', true),
  ])

  const total = totalResult.count || 0
  return {
    total_examples: total,
    by_source: {
      teach_me: teachMeResult.count || 0,
      feedback: feedbackResult.count || 0,
      implicit: implicitResult.count || 0,
    },
    rules_count: rulesResult.count || 0,
    ready_for_rules: total >= 50,
  }
}
