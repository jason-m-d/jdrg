import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const { data: projects, error } = await supabaseAdmin
    .from('projects')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Get document and conversation counts for each project
  const enriched = await Promise.all(
    projects.map(async (project) => {
      const [{ count: docCount }, { count: convCount }] = await Promise.all([
        supabaseAdmin
          .from('documents')
          .select('*', { count: 'exact', head: true })
          .eq('project_id', project.id),
        supabaseAdmin
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('project_id', project.id),
      ])

      return {
        ...project,
        document_count: docCount || 0,
        conversation_count: convCount || 0,
      }
    })
  )

  return NextResponse.json(enriched)
}

export async function POST(req: NextRequest) {
  const body = await req.json()

  const { data, error } = await supabaseAdmin
    .from('projects')
    .insert({
      name: body.name,
      description: body.description || '',
      color: body.color || '#6B7280',
      system_prompt: body.system_prompt || '',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
