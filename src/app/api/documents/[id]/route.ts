import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { chunkText } from '@/lib/chunker'
import { generateEmbedding } from '@/lib/voyage'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { data, error } = await supabaseAdmin
    .from('documents')
    .select('*, projects(name, color)')
    .eq('id', params.id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json(data)
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json()

  // Fetch existing document to check for content changes
  const { data: existing } = await supabaseAdmin
    .from('documents')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const contentChanged = body.content !== undefined && body.content !== existing.content

  // If living doc and content changed, create a version snapshot
  if (existing.is_living && contentChanged) {
    await supabaseAdmin.from('document_versions').insert({
      document_id: params.id,
      version: existing.version,
      content: existing.content,
      change_summary: body.change_summary || null,
    })
  }

  const update: Record<string, any> = {}
  if (body.title !== undefined) update.title = body.title
  if (body.content !== undefined) update.content = body.content
  if (body.project_id !== undefined) update.project_id = body.project_id || null
  if (body.is_living !== undefined) update.is_living = body.is_living
  if (body.is_pinned !== undefined) update.is_pinned = body.is_pinned
  if (body.is_template !== undefined) update.is_template = body.is_template
  if (contentChanged) update.version = (existing.version || 1) + 1

  const { data, error } = await supabaseAdmin
    .from('documents')
    .update(update)
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Re-chunk and embed if content changed
  if (contentChanged && body.content) {
    chunkAndEmbed(params.id, body.content).catch(console.error)
  }

  return NextResponse.json(data)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error } = await supabaseAdmin
    .from('documents')
    .delete()
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

async function chunkAndEmbed(documentId: string, content: string) {
  const chunks = chunkText(content)

  // Delete existing chunks
  await supabaseAdmin.from('document_chunks').delete().eq('document_id', documentId)

  for (let i = 0; i < chunks.length; i++) {
    try {
      const embedding = await generateEmbedding(chunks[i])
      await supabaseAdmin.from('document_chunks').insert({
        document_id: documentId,
        chunk_index: i,
        content: chunks[i],
        embedding,
      })
    } catch (e) {
      console.error(`Failed to embed chunk ${i}:`, e)
    }
  }
}
