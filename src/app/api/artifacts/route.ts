import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const conversationId = req.nextUrl.searchParams.get('conversation_id')
  const projectId = req.nextUrl.searchParams.get('project_id')

  let query = supabaseAdmin.from('artifacts').select('*').order('updated_at', { ascending: false })

  if (conversationId) {
    query = query.eq('conversation_id', conversationId)
  } else if (projectId) {
    query = query.eq('project_id', projectId)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { name, content, type, conversation_id, project_id } = body

  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

  const { data: artifact, error } = await supabaseAdmin
    .from('artifacts')
    .insert({
      name,
      content: content || '',
      type: type || 'freeform',
      conversation_id: conversation_id || null,
      project_id: project_id || null,
      version: 1,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Insert version 1
  await supabaseAdmin.from('artifact_versions').insert({
    artifact_id: artifact.id,
    content: artifact.content,
    version: 1,
    change_summary: 'Initial version',
    changed_by: 'user',
  })

  return NextResponse.json(artifact)
}
