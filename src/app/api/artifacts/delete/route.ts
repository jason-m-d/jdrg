import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const { artifact_id } = await req.json()
  if (!artifact_id) {
    return NextResponse.json({ error: 'artifact_id required' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('artifacts')
    .delete()
    .eq('id', artifact_id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ status: 'deleted' })
}
