import * as dotenv from 'dotenv'
import * as path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const openrouterClient = new OpenAI({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
})

const BACKGROUND_MODEL = 'google/gemini-2.0-flash-001'
const BACKGROUND_FALLBACK = 'google/gemini-flash-1.5'

// --- Auth ---
async function refreshAccessToken(account: string): Promise<string> {
  const { data: token, error } = await supabase
    .from('gmail_tokens')
    .select('*')
    .eq('account', account)
    .single()
  if (error || !token) throw new Error(`No token for ${account}: ${error?.message}`)

  if (token.expires_at && new Date(token.expires_at) > new Date()) {
    console.log(`[auth] Using cached token (expires ${token.expires_at})`)
    return token.access_token
  }
  console.log('[auth] Refreshing token...')
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID!,
      client_secret: process.env.GMAIL_CLIENT_SECRET!,
      refresh_token: token.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Refresh failed: ${JSON.stringify(data)}`)
  await supabase.from('gmail_tokens').update({
    access_token: data.access_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  }).eq('account', account)
  console.log(`[auth] New token obtained, expires_in=${data.expires_in}`)
  return data.access_token
}

// --- Gmail helpers (copied from gmail.ts) ---
function collectPartsMeta(payload: any): { filename: string; part: any }[] {
  const result: { filename: string; part: any }[] = []
  function walk(part: any) {
    if (!part) return
    const filename = part.filename || ''
    const mimeType = part.mimeType || ''
    if (filename && mimeType === 'application/pdf') result.push({ filename, part })
    if (part.parts) for (const child of part.parts) walk(child)
  }
  walk(payload)
  return result
}

async function getAttachments(payload: any, messageId: string, accessToken: string): Promise<{ filename: string; data: Buffer }[]> {
  const attachments: { filename: string; data: Buffer }[] = []
  const parts = collectPartsMeta(payload)
  console.log(`[attachments] Found ${parts.length} PDF parts in payload`)
  for (const { filename, part } of parts) {
    console.log(`[attachments] Processing: ${filename}`)
    let data: Buffer
    if (part.body?.data) {
      data = Buffer.from(part.body.data, 'base64url')
      console.log(`[attachments]   inline data, ${data.length} bytes`)
    } else if (part.body?.attachmentId) {
      console.log(`[attachments]   fetching via attachmentId: ${part.body.attachmentId}`)
      const res = await fetch(
        `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${part.body.attachmentId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      const attachData = await res.json()
      if (attachData.error) {
        console.warn(`[attachments]   ERROR: ${attachData.error.message}`)
        continue
      }
      data = Buffer.from(attachData.data, 'base64url')
      console.log(`[attachments]   fetched, ${data.length} bytes`)
    } else {
      console.warn(`[attachments]   no body.data or attachmentId, skipping`)
      continue
    }
    attachments.push({ filename, data })
  }
  return attachments
}

// --- PDF extraction ---
async function extractPdfText(buffer: Buffer): Promise<string> {
  const { extractText } = await import('unpdf')
  const result = await extractText(new Uint8Array(buffer))
  if (Array.isArray(result.text)) return result.text.join('\n\n')
  return String(result.text || '')
}

async function ocrPdfWithAI(buffer: Buffer): Promise<string> {
  console.log('[ocr] Running AI OCR on PDF via OpenRouter...')
  // Use openrouterClient for OCR too (Gemini Flash has native PDF support)
  // We'll send as base64 text since OpenAI SDK doesn't support document blocks
  // Instead fall back to a text extraction request with the raw base64
  const response = await openrouterClient.chat.completions.create({
    model: 'google/gemini-2.0-flash-001',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Extract all text from this PDF document. Return only the extracted text with no commentary, formatting markup, or preamble.',
        },
      ] as any,
    }],
    // @ts-ignore
    file: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') },
  } as any)
  return response.choices[0]?.message?.content || ''
}

// --- JSON schema helpers ---
function jsonBody(schema: Record<string, unknown>) {
  return {
    models: [BACKGROUND_MODEL, BACKGROUND_FALLBACK],
    provider: { sort: 'price' as const },
    plugins: [{ id: 'response-healing' }],
    response_format: { type: 'json_schema', json_schema: { name: 'response', strict: true, schema } },
  }
}

const WINGSTOP_SALES_SCHEMA = {
  type: 'object',
  properties: {
    stores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          store_number: { type: 'string' },
          store_name: { type: 'string' },
          net_sales: { type: 'number' },
          forecast_sales: { type: ['number', 'null'] },
          budget_sales: { type: ['number', 'null'] },
          report_date: { type: 'string' },
        },
        required: ['store_number', 'store_name', 'net_sales', 'forecast_sales', 'budget_sales', 'report_date'],
        additionalProperties: false,
      },
    },
  },
  required: ['stores'],
  additionalProperties: false,
}

const MR_PICKLES_SALES_SCHEMA = {
  type: 'object',
  properties: {
    stores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          store_number: { type: 'string' },
          store_name: { type: 'string' },
          net_sales: { type: 'number' },
          report_date: { type: 'string' },
        },
        required: ['store_number', 'store_name', 'net_sales', 'report_date'],
        additionalProperties: false,
      },
    },
  },
  required: ['stores'],
  additionalProperties: false,
}

// --- Main test logic ---
async function testBrand(accessToken: string, label: string, gmailQuery: string, isWingstop: boolean) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`=== ${label} ===`)
  console.log(`${'='.repeat(60)}`)
  console.log(`Query: ${gmailQuery}`)

  const listRes = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(gmailQuery)}&maxResults=5`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  const listData = await listRes.json()
  console.log(`List status: ${listRes.status}`)
  if (listData.error) { console.error('List error:', JSON.stringify(listData.error)); return }
  console.log(`Messages found: ${listData.messages?.length ?? 0} (resultSizeEstimate: ${listData.resultSizeEstimate})`)
  if (!listData.messages?.length) { console.log('No messages, skipping'); return }

  // Fetch first message
  const msgId = listData.messages[0].id
  console.log(`\nFetching message id: ${msgId}`)
  const msgRes = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  const msgData = await msgRes.json()
  if (msgData.error) { console.error('Fetch error:', JSON.stringify(msgData.error)); return }

  const headers = msgData.payload?.headers || []
  const subject = headers.find((h: any) => h.name === 'Subject')?.value || ''
  const from = headers.find((h: any) => h.name === 'From')?.value || ''
  const date = headers.find((h: any) => h.name === 'Date')?.value || ''
  console.log(`Subject: ${subject}`)
  console.log(`From: ${from}`)
  console.log(`Date: ${date}`)
  console.log(`internalDate: ${msgData.internalDate}`)

  // Count payload parts
  const partCount = msgData.payload?.parts?.length ?? 0
  console.log(`Payload parts: ${partCount}`)
  if (msgData.payload?.parts) {
    msgData.payload.parts.forEach((p: any, i: number) => {
      console.log(`  Part ${i}: mimeType=${p.mimeType} filename="${p.filename || ''}" body.size=${p.body?.size ?? 'n/a'} attachmentId=${p.body?.attachmentId ? 'YES' : 'no'}`)
      if (p.parts) {
        p.parts.forEach((pp: any, j: number) => {
          console.log(`    SubPart ${j}: mimeType=${pp.mimeType} filename="${pp.filename || ''}" body.size=${pp.body?.size ?? 'n/a'} attachmentId=${pp.body?.attachmentId ? 'YES' : 'no'}`)
        })
      }
    })
  }

  // Extract PDFs
  console.log('\nExtracting PDF attachments...')
  const attachments = await getAttachments(msgData.payload, msgId, accessToken)
  console.log(`Total PDF attachments: ${attachments.length}`)
  for (const att of attachments) {
    console.log(`  - ${att.filename}: ${att.data.length} bytes`)
  }

  if (attachments.length === 0) { console.log('No PDFs found, cannot proceed with parse test'); return }

  // Pick PDF - Wingstop prefers "forecast" or "actual" in name
  let pdf = attachments[0]
  if (isWingstop) {
    const forecastPdf = attachments.find(a =>
      a.filename.toLowerCase().includes('forecast') || a.filename.toLowerCase().includes('actual')
    )
    if (forecastPdf) { pdf = forecastPdf; console.log(`Using forecast PDF: ${pdf.filename}`) }
    else console.log(`No forecast PDF found, using first: ${pdf.filename}`)
  } else {
    console.log(`Using PDF: ${pdf.filename}`)
  }

  // Extract text
  console.log('\nExtracting text from PDF...')
  let pdfText = await extractPdfText(pdf.data)
  console.log(`extractPdfText returned ${pdfText.length} chars`)
  console.log(`First 500 chars:\n---\n${pdfText.slice(0, 500)}\n---`)

  if (pdfText.trim().length < 100) {
    console.log('\nText < 100 chars, trying AI OCR...')
    pdfText = await ocrPdfWithAI(pdf.data)
    console.log(`ocrPdfWithAI returned ${pdfText.length} chars`)
    console.log(`First 500 chars:\n---\n${pdfText.slice(0, 500)}\n---`)
  }

  if (!pdfText || pdfText.trim().length < 50) {
    console.log('Still no usable text after OCR, cannot run AI parse')
    return
  }

  // Run AI parse via openrouterClient (OpenAI-compatible, avoids Anthropic header)
  console.log('\nRunning AI sales parse via openrouterClient...')
  const systemPrompt = isWingstop
    ? `Parse this Wingstop "Daily Forecast vs Actuals Summary" report. The PDF has columns in this order: Sales Forecast, Sales Actual, Sales Variance.

CRITICAL: Extract the "Sales Actual" column, NOT "Sales Forecast". These are adjacent columns and easy to confuse. The Sales Actual value is the SECOND numeric column after the date, not the first.

For each store section (identified by store number like 0326, 0451, etc.), find the most recent date row that has a non-zero "Sales Actual" value. Extract:
- net_sales = the "Sales Actual" value (SECOND column, not first)
- forecast_sales = the "Sales Forecast" value (FIRST column)
- budget_sales = the "Sales Budget" or "Budget" value if present, otherwise null
- report_date = the date from that row

Store numbers to extract: 326, 451, 895, 1870, 2067, 2428, 2262, 2289. Strip leading zeros.

Return JSON only:
{ "stores": [{ "store_number": "326", "store_name": "Coleman", "net_sales": 10070.84, "forecast_sales": 13120.00, "budget_sales": null, "report_date": "2026-03-15" }] }

If a store has no actual data yet (Sales Actual is 0.00 for all dates), omit it. Use YYYY-MM-DD for dates.`
    : `Parse this Mr. Pickle's Daily Sales Report. Extract the Net Sales total (from the Net Sales section, not Gross Sales) for each store. The report date is in the header (Date: MM/DD/YYYY).

Stores to extract: 405 (Fresno / Blackstone) and 1008 (Van Nuys / Sepulveda). A single report may cover one or both stores.

Return JSON only:
{ "stores": [{ "store_number": "405", "store_name": "Fresno", "net_sales": 1234.56, "report_date": "2026-01-15" }] }

Use YYYY-MM-DD for dates.`

  const schema = isWingstop ? WINGSTOP_SALES_SCHEMA : MR_PICKLES_SALES_SCHEMA

  let aiRes: any
  try {
    aiRes = await openrouterClient.chat.completions.create({
      model: BACKGROUND_MODEL,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: pdfText.slice(0, 8000) },
      ],
      // @ts-ignore - OpenRouter extra fields
      ...jsonBody(schema),
    } as any)
  } catch (e: any) {
    console.error(`AI parse call failed: ${e.message}`)
    console.error(`Full error: ${JSON.stringify(e.error || e, null, 2)}`)
    return
  }
  console.log(`Model used: ${aiRes.model}`)
  const rawAiText = aiRes.choices[0]?.message?.content || '(no text)'
  console.log(`\nAI raw response:\n---\n${rawAiText}\n---`)

  try {
    const parsed = JSON.parse(rawAiText)
    console.log(`\nParsed stores: ${parsed.stores?.length ?? 0}`)
    if (parsed.stores) {
      for (const s of parsed.stores) {
        console.log(`  Store ${s.store_number} (${s.store_name}): net_sales=${s.net_sales} forecast=${s.forecast_sales ?? 'null'} budget=${s.budget_sales ?? 'null'} date=${s.report_date}`)
      }
    }
  } catch (e: any) {
    console.error(`JSON parse failed: ${e.message}`)
  }
}

async function main() {
  console.log('=== Sales Parse Debug Test (OpenRouter OpenAI client) ===\n')
  const account = 'jason@hungry.llc'
  const accessToken = await refreshAccessToken(account)
  console.log(`Access token: ${accessToken.slice(0, 20)}...`)

  await testBrand(accessToken, 'Wingstop NBO', 'subject:"NBO Daily Reports" newer_than:2d', true).catch(e => console.error('Wingstop test error:', e.message))
  await testBrand(accessToken, "Mr. Pickle's", 'subject:"Daily Sales" newer_than:2d', false).catch(e => console.error("MP test error:", e.message))

  console.log('\n=== Done ===')
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
