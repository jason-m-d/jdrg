import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase'
import { getTrainingStats } from '@/lib/training'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL })

export async function POST(req: NextRequest) {
  try {
    const stats = await getTrainingStats()

    if (!stats.ready_for_rules) {
      return NextResponse.json({
        error: `Need at least 50 training examples to extract rules. Currently have ${stats.total_examples}.`,
      }, { status: 400 })
    }

    // Fetch all training examples
    const { data: examples } = await supabaseAdmin
      .from('training_examples')
      .select('snippet, is_action_item, label_source')
      .order('created_at', { ascending: false })
      .limit(200)

    if (!examples || examples.length === 0) {
      return NextResponse.json({ error: 'No training examples found' }, { status: 400 })
    }

    // Format examples for Claude
    const exampleLines = examples.map(ex => {
      const label = ex.is_action_item ? 'ACTION ITEM' : 'NOT ACTION ITEM'
      const snippet = ex.snippet.length > 300 ? ex.snippet.slice(0, 300) + '...' : ex.snippet
      return `[${label}] ${snippet}`
    })

    const response = await anthropic.messages.create({
      model: 'google/gemini-3.1-flash-lite-preview',
      max_tokens: 1024,
      system: `You analyze labeled examples of emails/messages and extract clear rules about what the user considers an action item vs not.

Return JSON only:
{
  "rules": [
    {"rule": "Always flag compliance deadlines from Wingstop corporate", "category": "always_flag"},
    {"rule": "Never flag newsletter or marketing emails", "category": "never_flag"},
    {"rule": "Flag vendor payment requests only if they mention a deadline", "category": "conditional"}
  ]
}

Categories: always_flag, never_flag, conditional.
Keep rules specific and actionable. 5-10 rules max. Base them on clear patterns in the data.`,
      messages: [{
        role: 'user',
        content: `Here are ${examples.length} labeled examples. Extract rules:\n\n${exampleLines.join('\n\n')}`,
      }],
      ...({ extra_body: { models: ['google/gemini-3.1-flash-lite-preview', 'google/gemini-3-flash-preview'], provider: { sort: 'price' } } } as any),
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    let parsed: any
    try {
      const match = text.match(/\{[\s\S]*\}/)
      parsed = match ? JSON.parse(match[0]) : JSON.parse(text)
    } catch {
      return NextResponse.json({ error: 'Failed to parse rules from AI response' }, { status: 500 })
    }

    if (!parsed.rules || !Array.isArray(parsed.rules)) {
      return NextResponse.json({ error: 'Invalid rules format' }, { status: 500 })
    }

    // Deactivate old rules, insert new ones
    await supabaseAdmin
      .from('training_rules')
      .update({ is_active: false })
      .eq('is_active', true)

    const newRules = parsed.rules.map((r: any) => ({
      rule: r.rule,
      category: r.category,
      is_active: true,
    }))

    const { data: inserted } = await supabaseAdmin
      .from('training_rules')
      .insert(newRules)
      .select()

    return NextResponse.json({ rules: inserted, replaced_count: stats.rules_count })
  } catch (e: any) {
    console.error('Extract rules error:', e)
    return NextResponse.json({ error: e.message || 'Failed to extract rules' }, { status: 500 })
  }
}
