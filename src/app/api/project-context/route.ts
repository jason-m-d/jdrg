import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { chunkAndEmbedContext } from '@/lib/embed-context'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('project_id')

  let query = supabaseAdmin.from('project_context').select('*')
  if (projectId) query = query.eq('project_id', projectId)

  const { data, error } = await query.order('updated_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()

  const { data, error } = await supabaseAdmin
    .from('project_context')
    .insert({
      project_id: body.project_id,
      title: body.title,
      content: body.content,
      source_conversation_id: body.source_conversation_id || null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Background: chunk and embed
  if (data.content) {
    chunkAndEmbedContext(data.id, data.content).catch(console.error)
  }

  return NextResponse.json(data)
}
