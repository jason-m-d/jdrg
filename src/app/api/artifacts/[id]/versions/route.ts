import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data, error } = await supabaseAdmin
    .from('artifact_versions')
    .select('*')
    .eq('artifact_id', id)
    .order('version', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { restore_version } = await req.json()

  if (!restore_version) return NextResponse.json({ error: 'restore_version is required' }, { status: 400 })

  // Get current artifact
  const { data: current } = await supabaseAdmin.from('artifacts').select('*').eq('id', id).single()
  if (!current) return NextResponse.json({ error: 'Artifact not found' }, { status: 404 })

  // Get the version to restore
  const { data: targetVersion } = await supabaseAdmin
    .from('artifact_versions')
    .select('*')
    .eq('artifact_id', id)
    .eq('version', restore_version)
    .single()

  if (!targetVersion) return NextResponse.json({ error: 'Version not found' }, { status: 404 })

  // Snapshot current content before restoring
  await supabaseAdmin.from('artifact_versions').insert({
    artifact_id: id,
    content: current.content,
    version: current.version,
    change_summary: `Before restoring to version ${restore_version}`,
    changed_by: 'user',
  })

  // Update artifact with restored content
  const newVersion = current.version + 1
  const { data, error } = await supabaseAdmin
    .from('artifacts')
    .update({
      content: targetVersion.content,
      version: newVersion,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
