import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { chunkText } from '@/lib/chunker'
import { generateEmbedding } from '@/lib/voyage'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  let query = supabaseAdmin.from('documents').select('*, projects(name, color)')

  if (searchParams.get('project_id')) query = query.eq('project_id', searchParams.get('project_id'))
  if (searchParams.get('file_type')) query = query.eq('file_type', searchParams.get('file_type'))
  if (searchParams.get('is_living') === 'true') query = query.eq('is_living', true)
  if (searchParams.get('is_template') === 'true') query = query.eq('is_template', true)

  const { data, error } = await query.order('updated_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { data, error } = await supabaseAdmin
    .from('documents')
    .insert({
      title: body.title,
      content: body.content || '',
      file_type: body.file_type || 'created',
      project_id: body.project_id || null,
      is_living: body.is_living || false,
      is_pinned: body.is_pinned || false,
      is_template: body.is_template || false,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Background: chunk and embed
  if (data.content) {
    chunkAndEmbed(data.id, data.content).catch(console.error)
  }

  return NextResponse.json(data)
}

async function chunkAndEmbed(documentId: string, content: string) {
  const chunks = chunkText(content)

  // Delete existing chunks
  await supabaseAdmin.from('document_chunks').delete().eq('document_id', documentId)

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await generateEmbedding(chunks[i])
    await supabaseAdmin.from('document_chunks').insert({
      document_id: documentId,
      chunk_index: i,
      content: chunks[i],
      embedding,
    })
  }
}
