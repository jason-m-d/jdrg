import { supabaseAdmin } from '@/lib/supabase'

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

export async function refreshCalendarToken(account: string): Promise<string> {
  const { data: token } = await supabaseAdmin
    .from('calendar_tokens')
    .select('*')
    .eq('account', account)
    .single()

  if (!token) throw new Error(`No calendar token found for ${account}`)

  // Check if still valid (5-minute safety margin)
  if (token.expires_at && new Date(token.expires_at) > new Date(Date.now() + 300000)) {
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
  if (data.error) throw new Error(`Calendar token refresh failed: ${data.error}`)

  await supabaseAdmin.from('calendar_tokens').update({
    access_token: data.access_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  }).eq('account', account)

  return data.access_token
}

async function calendarFetch(account: string, url: string, accessToken?: string): Promise<{ data: any; accessToken: string }> {
  let token = accessToken || await refreshCalendarToken(account)

  let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })

  if (res.status === 401) {
    console.warn('[calendar] Got 401, clearing cached token and retrying...')
    await supabaseAdmin.from('calendar_tokens').update({ access_token: null, expires_at: null }).eq('account', account)
    token = await refreshCalendarToken(account)
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (res.status === 401) throw new Error('Calendar API error: 401 after token refresh')
  }

  const data = await res.json()
  if (data.error) {
    throw new Error(`Calendar API error: ${data.error.message || JSON.stringify(data.error)}`)
  }

  return { data, accessToken: token }
}

export interface CalendarListEntry {
  id: string
  summary: string
  primary: boolean
  accessRole: string
  backgroundColor?: string
}

export async function fetchCalendarList(account: string): Promise<CalendarListEntry[]> {
  const { data } = await calendarFetch(account, `${CALENDAR_API}/users/me/calendarList`)

  return (data.items || []).map((cal: any) => ({
    id: cal.id,
    summary: cal.summary || cal.id,
    primary: cal.primary || false,
    accessRole: cal.accessRole,
    backgroundColor: cal.backgroundColor,
  }))
}

export interface CalendarEvent {
  id: string
  title: string
  startTime: string | null
  endTime: string | null
  allDay: boolean
  location: string | null
  attendees: { email: string; name: string | null; responseStatus: string }[]
  description: string | null
  recurringEventId: string | null
  status: string
  organizerEmail: string | null
  calendarId: string
}

export async function fetchUpcomingEvents(
  account: string,
  timeMin: string,
  timeMax: string,
  maxResults: number = 100,
  calendarId: string = 'primary'
): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = []
  let pageToken: string | undefined
  let accessToken: string | undefined

  do {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      maxResults: String(Math.min(maxResults - events.length, 250)),
      singleEvents: 'true',
      orderBy: 'startTime',
    })
    if (pageToken) params.set('pageToken', pageToken)

    const url = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`
    const result = await calendarFetch(account, url, accessToken)
    accessToken = result.accessToken

    for (const evt of result.data.items || []) {
      const allDay = !!evt.start?.date
      events.push({
        id: evt.id,
        title: evt.summary || '(No title)',
        startTime: allDay ? evt.start.date : (evt.start?.dateTime || null),
        endTime: allDay ? evt.end.date : (evt.end?.dateTime || null),
        allDay,
        location: evt.location || null,
        attendees: (evt.attendees || []).map((a: any) => ({
          email: a.email,
          name: a.displayName || null,
          responseStatus: a.responseStatus || 'needsAction',
        })),
        description: evt.description || null,
        recurringEventId: evt.recurringEventId || null,
        status: evt.status || 'confirmed',
        organizerEmail: evt.organizer?.email || null,
        calendarId,
      })
    }

    pageToken = result.data.nextPageToken
  } while (pageToken && events.length < maxResults)

  return events
}

export interface CreateEventParams {
  title: string
  startTime: string
  endTime: string
  description?: string
  location?: string
  attendees?: string[]
}

export async function createCalendarEvent(
  account: string,
  params: CreateEventParams,
  calendarId: string = 'primary'
): Promise<CalendarEvent> {
  const accessToken = await refreshCalendarToken(account)

  const body: any = {
    summary: params.title,
    start: { dateTime: params.startTime },
    end: { dateTime: params.endTime },
  }
  if (params.description) body.description = params.description
  if (params.location) body.location = params.location
  if (params.attendees && params.attendees.length > 0) {
    body.attendees = params.attendees.map(email => ({ email }))
  }

  let res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (res.status === 401) {
    console.warn('[calendar] Got 401 on create, clearing cached token and retrying...')
    await supabaseAdmin.from('calendar_tokens').update({ access_token: null, expires_at: null }).eq('account', account)
    const newToken = await refreshCalendarToken(account)
    res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${newToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (res.status === 401) throw new Error('Calendar API error: 401 after token refresh')
  }

  const data = await res.json()
  if (data.error) {
    throw new Error(`Calendar API error: ${data.error.message || JSON.stringify(data.error)}`)
  }

  const allDay = !!data.start?.date
  const event: CalendarEvent = {
    id: data.id,
    title: data.summary || params.title,
    startTime: allDay ? data.start.date : (data.start?.dateTime || params.startTime),
    endTime: allDay ? data.end.date : (data.end?.dateTime || params.endTime),
    allDay,
    location: data.location || params.location || null,
    attendees: (data.attendees || []).map((a: any) => ({
      email: a.email,
      name: a.displayName || null,
      responseStatus: a.responseStatus || 'needsAction',
    })),
    description: data.description || params.description || null,
    recurringEventId: data.recurringEventId || null,
    status: data.status || 'confirmed',
    organizerEmail: data.organizer?.email || null,
    calendarId,
  }

  // Insert into local calendar_events table so it shows up immediately
  await supabaseAdmin.from('calendar_events').upsert({
    account,
    google_event_id: event.id,
    calendar_id: calendarId,
    title: event.title,
    description: event.description,
    start_time: event.startTime,
    end_time: event.endTime,
    location: event.location,
    attendees: event.attendees,
    all_day: event.allDay,
    recurring_event_id: event.recurringEventId,
    status: event.status,
    organizer_email: event.organizerEmail,
    synced_at: new Date().toISOString(),
  }, { onConflict: 'account,google_event_id' })

  return event
}

export async function getConnectedCalendarAccount(): Promise<string | null> {
  const { data: tokenRow } = await supabaseAdmin
    .from('calendar_tokens')
    .select('account')
    .limit(1)
    .single()

  return tokenRow?.account || null
}
