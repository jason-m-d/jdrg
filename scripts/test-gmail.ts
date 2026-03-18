import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

// Must come after dotenv.config
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function refreshAccessToken(account: string): Promise<string> {
  const { data: token, error } = await supabase
    .from('gmail_tokens')
    .select('*')
    .eq('account', account)
    .single()

  if (error || !token) throw new Error(`No token found for ${account}: ${error?.message}`)

  console.log(`Token row: account=${token.account} expires_at=${token.expires_at} has_refresh=${!!token.refresh_token} has_access=${!!token.access_token}`)

  // Check if still valid
  if (token.expires_at && new Date(token.expires_at) > new Date()) {
    console.log('Access token still valid, using cached token')
    return token.access_token
  }

  console.log('Access token expired or missing, refreshing...')

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
  console.log(`Token refresh response status: ${res.status}`)
  if (data.error) {
    console.error(`Token refresh error: ${JSON.stringify(data)}`)
    throw new Error(`Token refresh failed: ${data.error}`)
  }

  console.log(`New access token obtained, expires_in=${data.expires_in}`)

  await supabase.from('gmail_tokens').update({
    access_token: data.access_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  }).eq('account', account)

  return data.access_token
}

async function gmailList(accessToken: string, q: string, maxResults = 5) {
  const url = `https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=${maxResults}`
  console.log(`\nGmail list query: ${q}`)
  console.log(`URL: ${url}`)

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  const data = await res.json()

  console.log(`Status: ${res.status}`)
  if (data.error) {
    console.error(`Error: ${JSON.stringify(data.error)}`)
    return null
  }
  console.log(`Messages returned: ${data.messages?.length ?? 0}`)
  if (data.resultSizeEstimate !== undefined) console.log(`resultSizeEstimate: ${data.resultSizeEstimate}`)
  return data
}

async function gmailGetMessage(accessToken: string, messageId: string) {
  const res = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  const data = await res.json()
  if (data.error) {
    console.error(`Fetch message error: ${JSON.stringify(data.error)}`)
    return null
  }
  const headers = data.payload?.headers || []
  const subject = headers.find((h: any) => h.name === 'Subject')?.value || '(no subject)'
  const from = headers.find((h: any) => h.name === 'From')?.value || '(no from)'
  const date = headers.find((h: any) => h.name === 'Date')?.value || '(no date)'
  return { subject, from, date, internalDate: data.internalDate }
}

async function main() {
  const account = 'jason@hungry.llc'
  const EPOCH_MAR17 = 1742169600 // approx March 17 00:00 UTC 2026

  console.log('=== Gmail Debug Test ===')
  console.log(`Account: ${account}`)
  console.log(`GMAIL_CLIENT_ID set: ${!!process.env.GMAIL_CLIENT_ID}`)
  console.log(`GMAIL_CLIENT_SECRET set: ${!!process.env.GMAIL_CLIENT_SECRET}`)
  console.log(`SUPABASE_URL: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)

  let accessToken: string
  try {
    accessToken = await refreshAccessToken(account)
    console.log(`\nAccess token obtained (first 20 chars): ${accessToken.slice(0, 20)}...`)
  } catch (e: any) {
    console.error(`FATAL: Could not get access token: ${e.message}`)
    process.exit(1)
  }

  // Test 1: broad query
  console.log('\n--- Test 1: Broad query (after March 17) ---')
  const broadResult = await gmailList(accessToken, `after:${EPOCH_MAR17}`, 5)
  if (broadResult?.messages?.length > 0) {
    console.log('Fetching first message...')
    const msg = await gmailGetMessage(accessToken, broadResult.messages[0].id)
    if (msg) console.log(`First email: Subject="${msg.subject}" From="${msg.from}" Date="${msg.date}"`)
  }

  // Test 2: Wingstop NBO query
  console.log('\n--- Test 2: Wingstop NBO sales query ---')
  const wingsResult = await gmailList(accessToken, `after:${EPOCH_MAR17} subject:"NBO Daily Reports"`, 5)
  if (wingsResult?.messages?.length > 0) {
    console.log('Fetching first Wingstop message...')
    const msg = await gmailGetMessage(accessToken, wingsResult.messages[0].id)
    if (msg) console.log(`First Wingstop email: Subject="${msg.subject}" From="${msg.from}" Date="${msg.date}" internalDate=${msg.internalDate}`)
  }

  // Test 3: Mr. Pickle's query
  console.log('\n--- Test 3: Mr. Pickles sales query ---')
  const mpResult = await gmailList(accessToken, `after:${EPOCH_MAR17} subject:"Daily Sales"`, 5)
  if (mpResult?.messages?.length > 0) {
    console.log('Fetching first MP message...')
    const msg = await gmailGetMessage(accessToken, mpResult.messages[0].id)
    if (msg) console.log(`First MP email: Subject="${msg.subject}" From="${msg.from}" Date="${msg.date}" internalDate=${msg.internalDate}`)
  }

  // Test 4: What's actually in the gmail_tokens table
  console.log('\n--- Test 4: gmail_tokens table contents ---')
  const { data: tokens } = await supabase.from('gmail_tokens').select('account, expires_at, created_at')
  console.log('All token rows:', JSON.stringify(tokens, null, 2))

  // Test 5: email_scans table
  console.log('\n--- Test 5: email_scans table ---')
  const { data: scans } = await supabase.from('email_scans').select('*')
  console.log('All scan rows:', JSON.stringify(scans, null, 2))

  console.log('\n=== Done ===')
}

main().catch(e => {
  console.error('Unhandled error:', e)
  process.exit(1)
})
