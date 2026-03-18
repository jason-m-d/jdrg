import { supabaseAdmin } from '@/lib/supabase'

export async function searchEmails(query: string, maxResults: number = 10) {
  // Get first connected Gmail account
  const { data: tokenRow } = await supabaseAdmin
    .from('gmail_tokens')
    .select('account')
    .limit(1)
    .single()

  if (!tokenRow) throw new Error('No Gmail account connected')

  const accessToken = await refreshAccessToken(tokenRow.account)

  // Search messages
  const listRes = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  const listData = await listRes.json()

  if (listData.error) {
    throw new Error(`Gmail API error: ${listData.error.message || JSON.stringify(listData.error)}`)
  }

  if (!listData.messages) return []

  const emails = []
  for (const msg of listData.messages) {
    const msgRes = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    const msgData = await msgRes.json()

    const headers = msgData.payload?.headers || []
    const subject = headers.find((h: any) => h.name === 'Subject')?.value || ''
    const from = headers.find((h: any) => h.name === 'From')?.value || ''
    const date = headers.find((h: any) => h.name === 'Date')?.value || ''
    const body = getEmailBody(msgData.payload)

    emails.push({
      subject,
      from,
      date,
      snippet: body.slice(0, 1500),
    })
  }

  return emails
}

export async function refreshAccessToken(account: string): Promise<string> {
  const { data: token } = await supabaseAdmin
    .from('gmail_tokens')
    .select('*')
    .eq('account', account)
    .single()

  if (!token) throw new Error(`No token found for ${account}`)

  // Check if still valid
  if (token.expires_at && new Date(token.expires_at) > new Date()) {
    return token.access_token
  }

  // Refresh
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
  if (data.error) throw new Error(`Token refresh failed: ${data.error}`)

  await supabaseAdmin.from('gmail_tokens').update({
    access_token: data.access_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  }).eq('account', account)

  return data.access_token
}

export async function fetchEmails(account: string, since: Date, maxResults = 20, extraQuery?: string) {
  const accessToken = await refreshAccessToken(account)
  const sinceEpoch = Math.floor(since.getTime() / 1000)
  const q = extraQuery ? `after:${sinceEpoch} ${extraQuery}` : `after:${sinceEpoch}`

  console.log(`[gmail] fetchEmails q=${q} max=${maxResults}`)

  const listRes = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=${maxResults}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  const listData = await listRes.json()

  console.log(`[gmail] listData status=${listRes.status} messages=${listData.messages?.length ?? 0} error=${listData.error?.message ?? 'none'}`)

  if (listData.error) {
    throw new Error(`Gmail API error: ${listData.error.message || JSON.stringify(listData.error)}`)
  }

  if (!listData.messages) return []

  console.log(`[gmail] ${listData.messages.length} message IDs returned, fetching details...`)
  const emails = []
  for (let i = 0; i < listData.messages.length; i++) {
    const msg = listData.messages[i]
    const msgRes = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    const msgData = await msgRes.json()

    const headers = msgData.payload?.headers || []
    const subject = headers.find((h: any) => h.name === 'Subject')?.value || ''
    const from = headers.find((h: any) => h.name === 'From')?.value || ''
    const to = headers.find((h: any) => h.name === 'To')?.value || ''
    const body = getEmailBody(msgData.payload)
    const attachments = await getEmailAttachments(msgData.payload, msg.id, accessToken)

    console.log(`[gmail] ${i + 1}/${listData.messages.length} "${subject.slice(0, 50)}" (${attachments.length} PDFs)`)

    emails.push({
      id: msg.id,
      threadId: msgData.threadId || msg.id,
      subject,
      from,
      to,
      body,
      attachments,
      internalDate: msgData.internalDate,
    })
  }

  return emails
}

async function getEmailAttachments(payload: any, messageId: string, accessToken: string): Promise<{ filename: string; data: Buffer }[]> {
  const attachments: { filename: string; data: Buffer }[] = []

  const attachmentParts: { filename: string; part: any }[] = []
  function collectPartsMeta(part: any) {
    if (!part) return
    const filename = part.filename || ''
    const mimeType = part.mimeType || ''
    if (filename && mimeType === 'application/pdf') {
      attachmentParts.push({ filename, part })
    }
    if (part.parts) {
      for (const child of part.parts) collectPartsMeta(child)
    }
  }
  collectPartsMeta(payload)

  for (const { filename, part } of attachmentParts) {
    try {
      let data: Buffer
      if (part.body?.data) {
        // Inline attachment
        data = Buffer.from(part.body.data, 'base64url')
      } else if (part.body?.attachmentId) {
        // Fetch via attachment endpoint
        const res = await fetch(
          `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${part.body.attachmentId}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        )
        const attachData = await res.json()
        if (attachData.error) {
          console.warn(`Failed to fetch attachment ${filename}:`, attachData.error.message)
          continue
        }
        data = Buffer.from(attachData.data, 'base64url')
      } else {
        continue
      }
      attachments.push({ filename, data })
    } catch (e: any) {
      console.warn(`Error downloading attachment ${filename}:`, e.message)
    }
  }

  return attachments
}

export async function createDraft(to: string, subject: string, body: string, cc?: string): Promise<{ id: string; message: string }> {
  // Get first connected Gmail account
  const { data: tokenRow } = await supabaseAdmin
    .from('gmail_tokens')
    .select('account')
    .limit(1)
    .single()

  if (!tokenRow) throw new Error('No Gmail account connected')

  const accessToken = await refreshAccessToken(tokenRow.account)

  // Build RFC 2822 email
  const headers = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=utf-8`,
  ]
  if (cc) headers.push(`Cc: ${cc}`)

  const rawEmail = headers.join('\r\n') + '\r\n\r\n' + body
  const encodedEmail = Buffer.from(rawEmail).toString('base64url')

  const res = await fetch('https://www.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: { raw: encodedEmail },
    }),
  })

  const data = await res.json()
  if (data.error) throw new Error(`Draft creation failed: ${data.error.message}`)

  return { id: data.id, message: `Draft created: "${subject}" to ${to}` }
}

function getEmailBody(payload: any): string {
  if (!payload) return ''

  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8')
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64url').toString('utf-8')
      }
    }
    // Fallback to HTML
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        const html = Buffer.from(part.body.data, 'base64url').toString('utf-8')
        return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      }
    }
    // Recurse into multipart
    for (const part of payload.parts) {
      const body = getEmailBody(part)
      if (body) return body
    }
  }

  return ''
}
