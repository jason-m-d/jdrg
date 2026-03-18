import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { chunkText } from '@/lib/chunker'
import { generateEmbedding } from '@/lib/voyage'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const projectId = formData.get('project_id') as string | null

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const fileName = file.name
    const ext = fileName.split('.').pop()?.toLowerCase()

    // Upload to Supabase Storage
    const storagePath = `documents/${Date.now()}-${fileName}`
    const { error: storageError } = await supabaseAdmin.storage.from('documents').upload(storagePath, buffer, {
      contentType: file.type,
    })
    // Storage upload may fail if bucket doesn't exist, continue anyway
    if (storageError) {
      console.warn('Storage upload failed (continuing):', storageError.message)
    }

    // Extract text
    let content = ''
    let fileType = 'text'

    try {
      if (ext === 'pdf') {
        const { extractPdfText, ocrPdfWithAI } = await import('@/lib/pdf')
        content = await extractPdfText(buffer)
        fileType = 'pdf'

        if (content.trim().length < 100) {
          console.log(`PDF "${fileName}" yielded thin text (${content.trim().length} chars), falling back to OCR`)
          try {
            const ocrText = await ocrPdfWithAI(buffer)
            if (ocrText.trim().length > content.trim().length) {
              content = ocrText
            }
          } catch (ocrError: any) {
            console.warn('OCR fallback failed, using original text:', ocrError.message)
          }
        }
      } else if (ext === 'docx') {
        const mammoth = await import('mammoth')
        const result = await mammoth.extractRawText({ buffer })
        content = result.value
        fileType = 'docx'
      } else if (ext === 'xlsx' || ext === 'xls') {
        const XLSX = await import('xlsx')
        const workbook = XLSX.read(buffer, { type: 'buffer' })
        content = workbook.SheetNames.map(name => {
          const sheet = workbook.Sheets[name]
          return `Sheet: ${name}\n${XLSX.utils.sheet_to_csv(sheet)}`
        }).join('\n\n')
        fileType = 'xlsx'
      } else {
        content = buffer.toString('utf-8')
        fileType = 'text'
      }
    } catch (extractError: any) {
      console.error('Text extraction failed:', extractError.message)
      content = `[Failed to extract text from ${fileName}]`
    }

    // Create document
    const { data: doc, error } = await supabaseAdmin
      .from('documents')
      .insert({
        title: fileName.replace(/\.[^.]+$/, ''),
        content,
        file_url: storageError ? null : storagePath,
        file_type: fileType,
        project_id: projectId || null,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Background: chunk and embed
    if (content && !content.startsWith('[Failed')) {
      chunkAndEmbed(doc.id, content).catch(console.error)
    }

    return NextResponse.json(doc)
  } catch (err: any) {
    console.error('Upload error:', err)
    return NextResponse.json({ error: err.message || 'Upload failed' }, { status: 500 })
  }
}

async function chunkAndEmbed(documentId: string, content: string) {
  const chunks = chunkText(content)
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
